"""vaastav Fantasy-Premier-League archive ingestion (2020/21–2024/25).

Loads historical seasons from the vaastav GitHub archive into the fpl schema,
reusing the same load layer (idempotent upserts on natural keys) as the live
capture. Raw CSVs are cached under raw/{season}/ so re-runs skip the network.

Per-season load order:
    seasons → teams → canonical_players → players → gameweeks → fixtures
    → player_gameweeks

Season-specific rules:
  * data_tier: 2022-23/23-24/24-25 = full_xg; 2020-21/21-22 = no_xg. The no_xg
    archive has no Opta xG, so the expected_* columns are left null (correct).
  * Canonical identity: players link to fpl.canonical_players via FPL's
    persistent `code` (players_raw.csv). One player across seasons → ONE
    canonical row (upsert on fpl_code merges them).
  * selected_by is left null for archive seasons: the archive has no
    contemporaneous ranked_count denominator to turn `selected` into a %.
  * defensive_contribution is null (a 2025/26-only mechanic).

DEFERRED PERSONAL BACK-FILL (executed here — see _backfill_personal):
    --personal cached the manager's entry history, whose `past` array holds
    prior-season overall points/rank. Those rows could not be loaded into
    fpl.my_entry at capture time because my_entry.season_id FKs to fpl.seasons,
    which only held 2025-26. AFTER each archive season is inserted into
    fpl.seasons, this module back-fills the matching my_entry rows.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import random
import time
from pathlib import Path

import requests

from ingest import load, query
from ingest.transform import POSITION_MAP, _dec

log = logging.getLogger(__name__)

RAW_DIR = Path(__file__).parent.parent / "raw"
VAASTAV_BASE = (
    "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
)
USER_AGENT = "FPL-Badger/1.0 (archive ingest)"
MIN_INTERVAL = 1.05  # polite spacing between downloads

# (season_id, start_year, data_tier)
ARCHIVE_SEASONS = [
    ("2020-21", 2020, "no_xg"),
    ("2021-22", 2021, "no_xg"),
    ("2022-23", 2022, "full_xg"),
    ("2023-24", 2023, "full_xg"),
    ("2024-25", 2024, "full_xg"),
]

_last_request_at = 0.0


# ── Download (cache-first, rate-limited) ─────────────────────────────────────

def _throttle() -> None:
    global _last_request_at
    gap = time.monotonic() - _last_request_at
    if gap < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - gap + random.uniform(0, 0.15))
    _last_request_at = time.monotonic()


def _fetch_csv(season: str, filename: str, path_in_repo: str) -> list[dict]:
    """Return CSV rows as dicts; cache raw bytes under raw/{season}/."""
    path = RAW_DIR / season / filename
    if path.exists():
        text = path.read_bytes().decode("utf-8", errors="replace")
        return list(csv.DictReader(io.StringIO(text)))

    url = f"{VAASTAV_BASE}/{season}/{path_in_repo}"
    _throttle()
    log.info("download %s", url)
    resp = requests.get(url, timeout=60, headers={"User-Agent": USER_AGENT})
    resp.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    text = resp.content.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


# ── CSV → schema-shaped dicts ────────────────────────────────────────────────

def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _bool(v) -> bool:
    return str(v).strip().lower() in ("true", "1")


def _teams(rows: list[dict], season_id: str) -> list[dict]:
    return [
        {
            "season_id": season_id,
            "fpl_team_id": _int(t["id"]),
            "name": t["name"],
            "short_name": t["short_name"],
            "strength_overall_home": _int(t.get("strength_overall_home")),
            "strength_overall_away": _int(t.get("strength_overall_away")),
            "strength_attack_home": _int(t.get("strength_attack_home")),
            "strength_attack_away": _int(t.get("strength_attack_away")),
            "strength_defence_home": _int(t.get("strength_defence_home")),
            "strength_defence_away": _int(t.get("strength_defence_away")),
        }
        for t in rows
    ]


def _is_player(p: dict) -> bool:
    """Exclude managers: FPL added them as element_type=5 in 2024/25 (Assistant
    Manager chip). They aren't footballers and have no valid position."""
    return _int(p.get("element_type")) in POSITION_MAP


def _canonical(rows: list[dict]) -> list[dict]:
    return [
        {
            "full_name": f"{p['first_name']} {p['second_name']}",
            "fpl_code": _int(p["code"]),
        }
        for p in rows
        if _is_player(p)
    ]


def _players(rows: list[dict], season_id: str, team_map, canonical_map) -> list[dict]:
    out = []
    for p in rows:
        if not _is_player(p):
            continue
        out.append(
            {
                "season_id": season_id,
                "canonical_id": canonical_map.get(_int(p["code"])),
                "fpl_element_id": _int(p["id"]),
                "team_id": team_map.get(_int(p["team"])),
                "web_name": p.get("web_name"),
                "first_name": p.get("first_name"),
                "second_name": p.get("second_name"),
                "position": POSITION_MAP.get(_int(p["element_type"])),
            }
        )
    return out


def _gameweeks(fixtures_rows: list[dict], season_id: str) -> list[dict]:
    """Derive gameweeks from distinct fixture events (archive has no bootstrap
    events, so deadline/average/highest are unknown → null; finished=True)."""
    events = sorted({_int(f["event"]) for f in fixtures_rows if f.get("event")})
    return [
        {
            "season_id": season_id,
            "gw_number": gw,
            "deadline_time": None,
            "average_score": None,
            "highest_score": None,
            "finished": True,
        }
        for gw in events
    ]


def _fixtures(rows: list[dict], season_id: str, team_map) -> list[dict]:
    out = []
    for f in rows:
        out.append(
            {
                "season_id": season_id,
                "fpl_fixture_id": _int(f["id"]),
                "gw_number": _int(f.get("event")),
                "kickoff_time": f.get("kickoff_time") or None,
                "home_team_id": team_map.get(_int(f.get("team_h"))),
                "away_team_id": team_map.get(_int(f.get("team_a"))),
                "home_score": _int(f.get("team_h_score")),
                "away_score": _int(f.get("team_a_score")),
                "home_difficulty": _int(f.get("team_h_difficulty")),
                "away_difficulty": _int(f.get("team_a_difficulty")),
                "finished": _bool(f.get("finished")),
            }
        )
    return out


def _player_gameweeks(
    rows: list[dict], season_id: str, tier: str,
    player_map, fixture_map, team_map,
) -> tuple[list[dict], int]:
    """One row per player per fixture. Returns (rows, skipped_unmapped)."""
    has_xg = tier == "full_xg"
    out, skipped = [], 0
    for h in rows:
        player_id = player_map.get(_int(h["element"]))
        fixture_id = fixture_map.get(_int(h["fixture"]))
        if player_id is None or fixture_id is None:
            skipped += 1
            continue
        value = _int(h.get("value"))
        out.append(
            {
                "season_id": season_id,
                "player_id": player_id,
                "gw_number": _int(h["round"]),
                "fixture_id": fixture_id,
                "opponent_team_id": team_map.get(_int(h.get("opponent_team"))),
                "was_home": _bool(h.get("was_home")),
                "minutes": _int(h.get("minutes")) or 0,
                "total_points": _int(h.get("total_points")) or 0,
                "goals_scored": _int(h.get("goals_scored")) or 0,
                "assists": _int(h.get("assists")) or 0,
                "clean_sheets": _int(h.get("clean_sheets")) or 0,
                "goals_conceded": _int(h.get("goals_conceded")) or 0,
                "own_goals": _int(h.get("own_goals")) or 0,
                "penalties_saved": _int(h.get("penalties_saved")) or 0,
                "penalties_missed": _int(h.get("penalties_missed")) or 0,
                "yellow_cards": _int(h.get("yellow_cards")) or 0,
                "red_cards": _int(h.get("red_cards")) or 0,
                "saves": _int(h.get("saves")) or 0,
                "bonus": _int(h.get("bonus")) or 0,
                "bps": _int(h.get("bps")) or 0,
                "expected_goals": _dec(h.get("expected_goals")) if has_xg else None,
                "expected_assists": _dec(h.get("expected_assists")) if has_xg else None,
                "expected_goal_involvements":
                    _dec(h.get("expected_goal_involvements")) if has_xg else None,
                "expected_goals_conceded":
                    _dec(h.get("expected_goals_conceded")) if has_xg else None,
                "defensive_contribution": None,  # 2025/26-only mechanic
                "value": round(value / 10, 1) if value is not None else None,
                "selected_by": None,  # no contemporaneous ranked_count in archive
                "transfers_in": _int(h.get("transfers_in")),
                "transfers_out": _int(h.get("transfers_out")),
            }
        )
    return out, skipped


# ── Personal back-fill ───────────────────────────────────────────────────────

def _admin_user_id(client) -> str | None:
    rows = query.fetch_all(client, "user_roles", "user_id",
                           filters={"role": "admin"}, order="user_id")
    return rows[0]["user_id"] if len(rows) == 1 else None


def _find_history_cache() -> dict | None:
    import json
    entry_id = os.environ.get("FPL_ENTRY_ID")
    if not entry_id:
        return None
    for path in RAW_DIR.glob(f"*/entry-{entry_id}-history.json"):
        return json.loads(path.read_text())
    return None


def _backfill_personal(client, loaded_season_ids: set[str]) -> None:
    """Upsert my_entry rows for archive seasons now present in fpl.seasons,
    from the cached entry-history `past` array. Never touches the current
    season (not in loaded_season_ids), so its team_name is preserved.
    """
    user_id = _admin_user_id(client)
    history = _find_history_cache()
    entry_id = os.environ.get("FPL_ENTRY_ID")
    if not (user_id and history and entry_id):
        log.warning("personal back-fill skipped: user_id/history/entry_id missing")
        return

    filled = []
    for p in history.get("past", []):
        sid = (p.get("season_name") or "").replace("/", "-")
        if sid not in loaded_season_ids:
            continue  # not an archive season we just loaded (or is current)
        load.upsert_my_entry(client, {
            "user_id": user_id,
            "fpl_entry_id": int(entry_id),
            "season_id": sid,
            "team_name": None,  # past array carries no team name
            "overall_points": p.get("total_points"),
            "overall_rank": p.get("rank"),
        })
        filled.append(f"{sid}({p.get('total_points')}pts)")
    print(f"  personal back-fill: {filled if filled else 'no matching past seasons'}")


# ── Orchestration ────────────────────────────────────────────────────────────

def run(client, dry_run: bool = False) -> None:
    print("\n" + "=" * 60)
    print(f"  Archive capture{'  [DRY RUN — first season only]' if dry_run else ''}")
    print("=" * 60)

    seasons = ARCHIVE_SEASONS[:1] if dry_run else ARCHIVE_SEASONS
    loaded_ids: set[str] = set()

    for season_id, start_year, tier in seasons:
        print(f"\n── {season_id}  ({tier}) ──")

        # 1. season row FIRST (personal + FK dependencies need it)
        load.upsert_season(client, {
            "id": season_id,
            "start_year": start_year,
            "data_tier": tier,
            "is_current": False,
            "source": "archive",
        })
        loaded_ids.add(season_id)
        print(f"  season upserted ({tier})")

        # 2. download the four source files (cache-first)
        teams_rows = _fetch_csv(season_id, "teams.csv", "teams.csv")
        players_rows = _fetch_csv(season_id, "players_raw.csv", "players_raw.csv")
        fixtures_rows = _fetch_csv(season_id, "fixtures.csv", "fixtures.csv")
        merged_rows = _fetch_csv(season_id, "merged_gw.csv", "gws/merged_gw.csv")

        # 3. teams → canonical → players
        team_map = load.upsert_teams(client, _teams(teams_rows, season_id))
        canonical_map = load.upsert_canonical_players(client, _canonical(players_rows))
        player_map = load.upsert_players(
            client, _players(players_rows, season_id, team_map, canonical_map)
        )
        print(f"  teams={len(team_map)}  players={len(player_map)}")

        # 4. gameweeks → fixtures
        load.upsert_gameweeks(client, _gameweeks(fixtures_rows, season_id))
        fixture_map = load.upsert_fixtures(
            client, _fixtures(fixtures_rows, season_id, team_map)
        )
        print(f"  gameweeks derived  fixtures={len(fixture_map)}")

        # 5. player_gameweeks
        pgw_rows, skipped = _player_gameweeks(
            merged_rows, season_id, tier, player_map, fixture_map, team_map
        )
        n = load.upsert_player_gameweeks(client, pgw_rows)
        print(f"  player_gameweeks={n}  (skipped unmapped: {skipped})")

    # 6. deferred personal back-fill (after seasons exist in fpl.seasons)
    if not dry_run:
        print("\n── personal back-fill ──")
        _backfill_personal(client, loaded_ids)

    print("\nArchive capture done.")
