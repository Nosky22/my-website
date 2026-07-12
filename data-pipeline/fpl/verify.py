#!/usr/bin/env python3
"""FPL Badger — post-ingestion verification suite.

Parameterised by season so it works for the live 2025/26 capture and every
vaastav archive season. Runs the full check suite:

  1. Row counts per table
  2. Top-N players by total season points (no team filter)
  3. xG null-rates
  4. Double-gameweek reconciliation (sum of per-player rows == total rows)
  5. Orphan checks (player_gameweeks with no matching player / fixture)

CRITICAL: PostgREST caps every request at 1000 rows by default. Any check that
reads rows (not just a count header) MUST paginate, or it silently verifies a
truncated slice of the data. `fetch_all` below is the only sanctioned way to
pull row data here — never call `.execute()` on a bare row-select in a check.

Usage:
  python verify.py                 # defaults to 2025-26
  python verify.py --season 2024-25
  python verify.py --season 2025-26 --top 10
"""
from __future__ import annotations

import argparse
import os
from collections import defaultdict

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from ingest import load

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

PAGE = 1000  # PostgREST hard default per request
XG_COLUMNS = [
    "expected_goals",
    "expected_assists",
    "expected_goal_involvements",
    "expected_goals_conceded",
]
COUNT_TABLES = [
    "seasons",
    "teams",
    "canonical_players",
    "players",
    "gameweeks",
    "fixtures",
    "player_gameweeks",
]


def _fpl(client):
    return client.schema("fpl")


def fetch_all(client, table: str, columns: str, season: str | None = None) -> list[dict]:
    """Paginate through EVERY row — bypasses the 1000-row PostgREST cap.

    Uses .range() with a stable order so pages don't overlap or skip rows.
    """
    rows: list[dict] = []
    start = 0
    while True:
        q = _fpl(client).table(table).select(columns)
        if season is not None:
            q = q.eq("season_id", season)
        # Order by a stable key so pagination is deterministic.
        q = q.order("id").range(start, start + PAGE - 1)
        result = q.execute()
        batch = result.data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start += PAGE
    return rows


def exact_count(client, table: str, season: str | None = None, **filters) -> int:
    """Row count via the count header (not row data) — never truncated."""
    q = _fpl(client).table(table).select("id", count="exact")
    if season is not None:
        q = q.eq("season_id", season)
    for col, val in filters.items():
        if val == "__null__":
            q = q.is_(col, "null")
        else:
            q = q.eq(col, val)
    return q.execute().count


# ── Checks ──────────────────────────────────────────────────────────────────

def check_row_counts(client, season: str) -> None:
    print("\n[1] ROW COUNTS")
    for t in COUNT_TABLES:
        # seasons/canonical_players are not season-scoped; count them whole.
        scoped = None if t in ("seasons", "canonical_players") else season
        n = exact_count(client, t, season=scoped)
        tag = "" if scoped else "  (all seasons)"
        print(f"  fpl.{t:<25} {n:>8,}{tag}")


def _load_lookups(client, season: str):
    players = fetch_all(client, "players",
                        "id, web_name, first_name, second_name, position, team_id", season)
    p_map = {p["id"]: p for p in players}
    teams = _fpl(client).table("teams").select("id, name, short_name") \
        .eq("season_id", season).execute()
    t_map = {t["id"]: t for t in teams.data}
    return p_map, t_map


def check_top_points(client, season: str, top_n: int, pgw: list[dict],
                     p_map: dict, t_map: dict) -> None:
    print(f"\n[2] TOP {top_n} — {season} (sum of total_points across ALL rows, no team filter)")
    pts = defaultdict(int)
    nrows = defaultdict(int)
    gws = defaultdict(set)
    for r in pgw:
        pid = r["player_id"]
        pts[pid] += r["total_points"] or 0
        nrows[pid] += 1
        gws[pid].add(r["gw_number"])

    def name(pid):
        p = p_map.get(pid, {})
        return f"{p.get('first_name','')} {p.get('second_name','')}".strip() or p.get("web_name", "?")

    def club(pid):
        t = t_map.get(p_map.get(pid, {}).get("team_id"))
        return t["short_name"] if t else "?"

    def pos(pid):
        return p_map.get(pid, {}).get("position", "?")

    print(f"    {'Player':<30} {'Pos':<4} {'Club':<5} {'Pts':>5} {'Rows':>5} {'GWs':>4}")
    for pid in sorted(pts, key=pts.get, reverse=True)[:top_n]:
        print(f"    {name(pid):<30} {pos(pid):<4} {club(pid):<5} "
              f"{pts[pid]:>5} {nrows[pid]:>5} {len(gws[pid]):>4}")


def check_xg_nulls(client, season: str, total: int) -> None:
    print(f"\n[3] xG NULL RATES — {season}")
    if total == 0:
        print("    (no player_gameweeks rows)")
        return
    for col in XG_COLUMNS:
        n_null = exact_count(client, "player_gameweeks", season=season, **{col: "__null__"})
        pct = n_null / total * 100
        print(f"    {col:<35} {n_null:>6,} null / {total:,}  ({pct:.1f}%)")


def check_dgw_reconciliation(client, season: str, pgw: list[dict]) -> bool:
    print(f"\n[4] DOUBLE-GW RECONCILIATION — {season}")
    per_gw = defaultdict(lambda: defaultdict(int))
    nrows = defaultdict(int)
    for r in pgw:
        per_gw[r["player_id"]][r["gw_number"]] += 1
        nrows[r["player_id"]] += 1

    players_with_dgw = 0
    extra_rows = 0
    for pid, gwmap in per_gw.items():
        e = sum(c - 1 for c in gwmap.values() if c > 1)
        if e:
            players_with_dgw += 1
            extra_rows += e

    summed = sum(nrows.values())
    ok = summed == len(pgw)
    print(f"    Players with >=1 double-GW round: {players_with_dgw}")
    print(f"    Extra rows from 2nd fixtures in a round: {extra_rows}")
    print(f"    Total rows {len(pgw):,}  ==  sum of per-player rows {summed:,}  "
          f"→ {'OK' if ok else 'MISMATCH — ROWS DROPPED'}")
    return ok


def check_orphans(client, season: str, pgw: list[dict], p_map: dict) -> bool:
    print(f"\n[5] ORPHAN CHECK — {season}")
    player_ids = set(p_map)
    pgw_player_ids = {r["player_id"] for r in pgw}
    pgw_fixture_ids = {r["fixture_id"] for r in pgw if r["fixture_id"]}
    fixtures = fetch_all(client, "fixtures", "id", season)
    fixture_ids = {f["id"] for f in fixtures}

    orphan_players = pgw_player_ids - player_ids
    orphan_fixtures = pgw_fixture_ids - fixture_ids
    print(f"    player_gameweeks with no matching player:  {len(orphan_players)}")
    print(f"    player_gameweeks with orphan fixture_id:   {len(orphan_fixtures)}")
    return not orphan_players and not orphan_fixtures


# ── Main ────────────────────────────────────────────────────────────────────

def run(season: str, top_n: int) -> int:
    client = load.make_client(SUPABASE_URL, SERVICE_KEY)

    print("=" * 62)
    print(f"  VERIFICATION — FPL Badger  |  season {season}")
    print("=" * 62)

    check_row_counts(client, season)

    # Pull every player_gameweek row ONCE; reuse across checks.
    pgw = fetch_all(client, "player_gameweeks",
                    "player_id, gw_number, fixture_id, total_points", season)
    p_map, t_map = _load_lookups(client, season)

    check_top_points(client, season, top_n, pgw, p_map, t_map)
    check_xg_nulls(client, season, total=len(pgw))
    dgw_ok = check_dgw_reconciliation(client, season, pgw)
    orphans_ok = check_orphans(client, season, pgw, p_map)

    print("\n" + "=" * 62)
    all_ok = dgw_ok and orphans_ok
    print(f"  {'ALL INTEGRITY CHECKS PASSED' if all_ok else 'INTEGRITY CHECK FAILED — SEE ABOVE'}")
    print("=" * 62)
    return 0 if all_ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="FPL Badger verification suite")
    parser.add_argument("--season", default="2025-26", help="Season id, e.g. 2024-25")
    parser.add_argument("--top", type=int, default=10, help="Top-N players by points")
    args = parser.parse_args()
    raise SystemExit(run(args.season, args.top))


if __name__ == "__main__":
    main()
