#!/usr/bin/env python3
"""FPL Badger Phase 0 — data ingestion entry point.

Usage:
  python run_phase0.py --dry-run     # Single best player, one GW row — verify mapping
  python run_phase0.py --live        # Full 2025/26 from live FPL API
  python run_phase0.py --personal    # My entry, GW history, transfers, league standings
  python run_phase0.py --archive     # 2020/21–2024/25 from vaastav archive
  python run_phase0.py --all         # Everything in priority order
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from dotenv import load_dotenv

# Load secrets from .env in the same directory as this script
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from ingest import archive as archive_mod
from ingest import backup, fpl_api, load, transform

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

SEASON = "2025-26"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
FPL_ENTRY_ID = int(os.environ["FPL_ENTRY_ID"])
FPL_LEAGUE_IDS = [int(x) for x in os.environ["FPL_LEAGUE_IDS"].split(",")]


# ── Live 2025/26 ──────────────────────────────────────────────────────────────

def run_live(client, dry_run: bool = False) -> None:
    print("\n" + "=" * 60)
    print(f"  Live {SEASON} capture{'  [DRY RUN — 1 player, 1 GW row]' if dry_run else ''}")
    print("=" * 60)

    # 1. Bootstrap
    print("\n[1/7] Fetching bootstrap-static...")
    bootstrap = fpl_api.get_bootstrap(SEASON)
    total_fpl_players = bootstrap.get("total_players", 0)
    elements = bootstrap["elements"]
    # ranked_count per GW = managers who have submitted a team by that GW's deadline.
    # Use this as the ownership denominator — NOT total_players (end-of-season figure).
    gw_ranked_count: dict[int, int] = {
        e["id"]: e["ranked_count"]
        for e in bootstrap["events"]
        if e.get("ranked_count")
    }
    print(
        f"  {len(elements)} players  |  {len(bootstrap['teams'])} teams  |"
        f"  {len(bootstrap['events'])} GWs  |  {total_fpl_players:,} total FPL managers"
    )

    # 2. Season
    print("\n[2/7] Upserting season...")
    load.upsert_season(client, transform.transform_season(bootstrap, SEASON))
    print("  done")

    # 3. Teams
    print("\n[3/7] Upserting teams...")
    team_map = load.upsert_teams(client, transform.transform_teams(bootstrap, SEASON))
    print(f"  {len(team_map)} teams")

    # 4. Gameweeks
    print("\n[4/7] Upserting gameweeks...")
    load.upsert_gameweeks(client, transform.transform_gameweeks(bootstrap, SEASON))
    print(f"  {len(bootstrap['events'])} gameweeks")

    # 5. Canonical players
    print("\n[5/7] Upserting canonical players...")
    canonical_rows = transform.transform_canonical_players(bootstrap)
    canonical_map = load.upsert_canonical_players(client, canonical_rows)
    print(f"  {len(canonical_map)} canonical players")

    # 6. Players (season-specific)
    print("\n[6/7] Upserting players...")
    player_rows = transform.transform_players(bootstrap, SEASON, team_map, canonical_map)
    player_map = load.upsert_players(client, player_rows)
    print(f"  {len(player_map)} players")

    # 7. Fixtures
    print("\n[7/7] Fetching + upserting fixtures...")
    fixtures_raw = fpl_api.get_fixtures(SEASON)
    fixture_map = load.upsert_fixtures(
        client, transform.transform_fixtures(fixtures_raw, SEASON, team_map)
    )
    print(f"  {len(fixture_map)} fixtures")

    # ── Player gameweeks ───────────────────────────────────────────────────────
    print("\n[element-summaries]")

    target_elements = elements
    if dry_run:
        # Pick the highest-scoring player for a meaningful test
        target_elements = [max(elements, key=lambda e: e["total_points"])]
        el = target_elements[0]
        print(
            f"  Dry-run player: {el['web_name']} "
            f"(id={el['id']}, pos={transform.POSITION_MAP[el['element_type']]}, "
            f"total_pts={el['total_points']})"
        )

    errors = 0
    for i, el in enumerate(target_elements, 1):
        element_id = el["id"]
        player_id = player_map.get(element_id)
        if player_id is None:
            log.warning("No player_id for element_id=%s — skipping", element_id)
            errors += 1
            continue

        if not dry_run and i % 100 == 0:
            print(f"  {i}/{len(target_elements)} players processed...")

        try:
            summary = fpl_api.get_element_summary(SEASON, element_id)
            history = summary.get("history", [])
            if not history:
                continue

            pgw_rows = transform.transform_player_gameweeks(
                history, player_id, SEASON, fixture_map, team_map, gw_ranked_count
            )

            if dry_run:
                # Upsert only the first GW row, then query it back
                single = pgw_rows[:1]
                load.upsert_player_gameweeks(client, single)

                result = (
                    client.schema("fpl")
                    .table("player_gameweeks")
                    .select(
                        "gw_number, was_home, minutes, total_points, goals_scored,"
                        " assists, clean_sheets, bonus, bps,"
                        " expected_goals, expected_assists, expected_goal_involvements,"
                        " expected_goals_conceded, value, selected_by,"
                        " transfers_in, transfers_out, defensive_contribution"
                    )
                    .eq("player_id", player_id)
                    .order("gw_number")
                    .limit(1)
                    .execute()
                )

                print("\n--- Row in DB (fpl.player_gameweeks) ---")
                print(json.dumps(result.data, indent=2, default=str))

                print("\n--- Corresponding raw API history[0] ---")
                raw_row = {
                    k: v
                    for k, v in summary["history"][0].items()
                    if k in (
                        "round", "fixture", "opponent_team", "was_home", "minutes",
                        "total_points", "goals_scored", "assists", "clean_sheets",
                        "bonus", "bps", "expected_goals", "expected_assists",
                        "expected_goal_involvements", "expected_goals_conceded",
                        "value", "selected", "transfers_in", "transfers_out",
                    )
                }
                print(json.dumps(raw_row, indent=2, default=str))

                first_h = summary["history"][0]
                sel = first_h.get("selected", 0)
                gw_num = first_h.get("round", 1)
                gw_rc = gw_ranked_count.get(gw_num, 0)
                if gw_rc > 0:
                    print(
                        f"\nnote: GW{gw_num} selected_by = {sel:,} / {gw_rc:,} ranked managers"
                        f" = {sel/gw_rc*100:.2f}%"
                        f"  (end-of-season total: {total_fpl_players:,})"
                    )
                return  # stop after dry-run

            else:
                count = load.upsert_player_gameweeks(client, pgw_rows)
                log.debug("element_id=%s → %s rows", element_id, count)

        except Exception as exc:
            log.error("element_id=%s: %s", element_id, exc)
            errors += 1

    if not dry_run:
        print(f"\nLive capture done. Errors: {errors}")


# ── Personal data ─────────────────────────────────────────────────────────────

def run_personal(client) -> None:
    print("\n" + "=" * 60)
    print("  Personal data capture")
    print("=" * 60)

    # Entry
    print(f"\n[1/3] Fetching entry {FPL_ENTRY_ID}...")
    entry = fpl_api.get_entry(SEASON, FPL_ENTRY_ID)
    print(f"  Team: {entry.get('name')}  Manager: {entry.get('player_first_name')} {entry.get('player_last_name')}")

    # Entry history
    print(f"\n[2/3] Fetching entry history {FPL_ENTRY_ID}...")
    history = fpl_api.get_entry_history(SEASON, FPL_ENTRY_ID)
    current = history.get("current", [])
    print(f"  {len(current)} GW records")

    # Leagues
    print(f"\n[3/3] Fetching {len(FPL_LEAGUE_IDS)} mini-league(s)...")
    for league_id in FPL_LEAGUE_IDS:
        page = 1
        while True:
            data = fpl_api.get_league_standings(SEASON, league_id, page)
            standings = data.get("standings", {})
            results = standings.get("results", [])
            print(f"  league {league_id} page {page}: {len(results)} entries")
            if not standings.get("has_next"):
                break
            page += 1

    print("\nPersonal data cached to raw/. DB load not yet implemented — Phase 0 step 2.")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="FPL Badger Phase 0 ingestion")
    parser.add_argument("--dry-run", action="store_true", help="Single-player test")
    parser.add_argument("--live", action="store_true", help="Full 2025/26 live capture")
    parser.add_argument("--personal", action="store_true", help="Entry + league data")
    parser.add_argument("--archive", action="store_true", help="vaastav archive seasons")
    parser.add_argument("--all", action="store_true", help="All phases in order")
    args = parser.parse_args()

    if not any(vars(args).values()):
        parser.print_help()
        sys.exit(1)

    client = load.make_client(SUPABASE_URL, SERVICE_KEY)

    if args.dry_run:
        run_live(client, dry_run=True)

    elif args.live or args.all:
        run_live(client, dry_run=False)
        if args.all:
            run_personal(client)
            archive_mod.run(client)

    elif args.personal:
        run_personal(client)

    elif args.archive:
        archive_mod.run(client)


if __name__ == "__main__":
    main()
