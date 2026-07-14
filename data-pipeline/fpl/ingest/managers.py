"""Elite-manager action capture for 2025/26 (time-critical, one-shot).

Captures the actions of the top ~150 managers in league 314 (Overall) before
the FPL API resets to the new season and this data disappears:
  * entry/{id}/event/{gw}/picks/  → manager_picks (XI/cap/vice/bench/multiplier
    /slot) + manager_gameweeks (chip + aggregates + rank)
  * entry/{id}/transfers/         → manager_transfers
  * entry/{id}/history/           → manager_seasons (past-season summaries)

SURVIVORSHIP BIAS — read every analysis through this lens:
  This cohort is "elite in 2025/26". 123 of the 150 have ZERO prior top-10k
  finishes and 12 are brand-new accounts (the world #1 among them). Read the
  data for REPEATED PATTERNS across the skill-consistent sub-cohort (>=1 or
  >=2 prior top-10k finishes), never for individual outcomes. See README.md.

Cache-first: every raw response is saved under raw/2025-26/managers/ before
transform, so the run is resume-safe and self-backing. Idempotent upserts.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from ingest import fpl_api, load, query

log = logging.getLogger(__name__)

SEASON = "2025-26"
LEAGUE_OVERALL = 314
COHORT_SIZE = 150
GWS = range(1, 39)

BASE = "https://fantasy.premierleague.com/api/"
RAW = Path(__file__).parent.parent / "raw" / SEASON / "managers"


# ── Cache-first fetch ────────────────────────────────────────────────────────

def _cached_get(rel: str, url: str):
    path = RAW / rel
    if path.exists():
        return json.loads(path.read_text())
    data = fpl_api._get(url)  # rate-limited (1.05s) + retry/backoff on 429/5xx
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def cohort_entry_ids(size: int = COHORT_SIZE) -> list[int]:
    """Top-N entry ids from cached league-314 standings pages."""
    entries: list[dict] = []
    page = 1
    while len(entries) < size:
        d = _cached_get(
            f"league-{LEAGUE_OVERALL}-p{page}.json",
            f"{BASE}leagues-classic/{LEAGUE_OVERALL}/standings/?page_standings={page}",
        )
        entries.extend(d["standings"]["results"])
        if not d["standings"].get("has_next"):
            break
        page += 1
    return [e["entry"] for e in entries[:size]]


# ── Transforms ───────────────────────────────────────────────────────────────

def _to_manager_gameweek(picks: dict, entry_id: int) -> dict:
    eh = picks.get("entry_history", {})
    bank = eh.get("bank")
    value = eh.get("value")
    return {
        "season_id": SEASON,
        "manager_entry_id": entry_id,
        "gw_number": eh.get("event"),
        "points": eh.get("points"),
        "total_points": eh.get("total_points"),
        "overall_rank": eh.get("overall_rank"),
        "gw_rank": eh.get("rank"),
        "bank": round(bank / 10, 1) if bank is not None else None,
        "team_value": round(value / 10, 1) if value is not None else None,
        "event_transfers": eh.get("event_transfers"),
        "event_transfers_cost": eh.get("event_transfers_cost"),
        "points_on_bench": eh.get("points_on_bench"),
        "chip": picks.get("active_chip"),
    }


def _to_manager_picks(picks: dict, entry_id: int, gw: int, elem_map: dict) -> list[dict]:
    rank_snap = picks.get("entry_history", {}).get("overall_rank")
    rows = []
    for p in picks.get("picks", []):
        rows.append({
            "season_id": SEASON,
            "manager_entry_id": entry_id,
            "manager_rank_snapshot": rank_snap,
            "gw_number": gw,
            "player_id": elem_map.get(p.get("element")),
            "position": p.get("position"),
            "is_captain": bool(p.get("is_captain")),
            "is_vice": bool(p.get("is_vice_captain")),
            "multiplier": p.get("multiplier"),
        })
    return rows


def _to_manager_transfers(transfers: list, entry_id: int, elem_map: dict) -> list[dict]:
    rows = []
    for t in transfers:
        cin = t.get("element_in_cost")
        cout = t.get("element_out_cost")
        rows.append({
            "season_id": SEASON,
            "manager_entry_id": entry_id,
            "gw_number": t.get("event"),
            "player_in_id": elem_map.get(t.get("element_in")),
            "player_out_id": elem_map.get(t.get("element_out")),
            "player_in_cost": round(cin / 10, 1) if cin is not None else None,
            "player_out_cost": round(cout / 10, 1) if cout is not None else None,
            "transfer_time": t.get("time"),
        })
    return rows


def _to_manager_seasons(history: dict, entry_id: int) -> list[dict]:
    return [
        {
            "manager_entry_id": entry_id,
            "season_name": p.get("season_name"),
            "total_points": p.get("total_points"),
            "overall_rank": p.get("rank"),
        }
        for p in history.get("past", [])
    ]


# ── Orchestration ────────────────────────────────────────────────────────────

def run(client, dry_run: bool = False) -> None:
    print("\n" + "=" * 60)
    print(f"  Elite-manager capture{'  [DRY RUN — 1 manager]' if dry_run else ''}")
    print("=" * 60)

    # element -> player_id for 2025-26 (for picks + transfers)
    players = query.fetch_all(client, "players", "id, fpl_element_id",
                              filters={"season_id": SEASON})
    elem_map = {p["fpl_element_id"]: p["id"] for p in players}
    print(f"  element→player_id map: {len(elem_map)} players")

    entry_ids = cohort_entry_ids()
    if dry_run:
        entry_ids = entry_ids[:1]
    print(f"  cohort: {len(entry_ids)} managers\n")

    tot = {"picks": 0, "gws": 0, "transfers": 0, "seasons": 0}
    errors = 0
    for i, eid in enumerate(entry_ids, 1):
        try:
            # history → manager_seasons
            hist = _cached_get(f"history/{eid}.json", f"{BASE}entry/{eid}/history/")
            tot["seasons"] += load.upsert_manager_seasons(
                client, _to_manager_seasons(hist, eid))

            # transfers → manager_transfers
            trans = _cached_get(f"transfers/{eid}.json", f"{BASE}entry/{eid}/transfers/")
            tot["transfers"] += load.upsert_manager_transfers(
                client, _to_manager_transfers(trans, eid, elem_map))

            # picks per GW → manager_gameweeks + manager_picks
            mg_rows, mp_rows = [], []
            for gw in GWS:
                try:
                    picks = _cached_get(
                        f"picks/{eid}/{gw}.json",
                        f"{BASE}entry/{eid}/event/{gw}/picks/",
                    )
                except Exception as exc:  # e.g. GW the manager wasn't active
                    log.warning("entry=%s gw=%s picks: %s", eid, gw, exc)
                    continue
                mg_rows.append(_to_manager_gameweek(picks, eid))
                mp_rows.extend(_to_manager_picks(picks, eid, gw, elem_map))
            tot["gws"] += load.upsert_manager_gameweeks(client, mg_rows)
            tot["picks"] += load.upsert_manager_picks(client, mp_rows)

            if i % 10 == 0 or dry_run:
                print(f"  {i}/{len(entry_ids)} done (entry {eid})")
        except Exception as exc:
            log.error("entry=%s failed: %s", eid, exc)
            errors += 1

    print(f"\nCapture done. Errors: {errors}")
    print(f"  manager_picks rows:      {tot['picks']:,}")
    print(f"  manager_gameweeks rows:  {tot['gws']:,}")
    print(f"  manager_transfers rows:  {tot['transfers']:,}")
    print(f"  manager_seasons rows:    {tot['seasons']:,}")
