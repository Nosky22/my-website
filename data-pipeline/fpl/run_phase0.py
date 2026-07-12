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
from ingest import backup, fpl_api, load, query, transform

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

def _admin_user_id(client) -> str:
    """The single admin in fpl.user_roles — every personal row is attributed here."""
    # user_roles' PK is user_id (no `id` column) — order by it explicitly.
    rows = query.fetch_all(
        client, "user_roles", "user_id", filters={"role": "admin"}, order="user_id"
    )
    if len(rows) != 1:
        raise SystemExit(
            f"Expected exactly 1 admin in fpl.user_roles, found {len(rows)}. "
            "Cannot attribute personal data safely."
        )
    return rows[0]["user_id"]


def run_personal(client) -> None:
    print("\n" + "=" * 60)
    print("  Personal data capture")
    print("=" * 60)

    user_id = _admin_user_id(client)
    print(f"\nAttributing to admin user_id: {user_id}")

    # 1. Entry (identity + season summary)
    print(f"\n[1/4] Entry {FPL_ENTRY_ID}...")
    entry = fpl_api.get_entry(SEASON, FPL_ENTRY_ID)
    print(f"  Team: {entry.get('name')}  Manager: "
          f"{entry.get('player_first_name')} {entry.get('player_last_name')}")
    load.upsert_my_entry(client, transform.transform_my_entry(entry, user_id, SEASON))
    print(f"  my_entry loaded ({SEASON})")

    # 2. Entry history → per-GW rows (+ cache transfers for later use)
    print(f"\n[2/4] Entry history {FPL_ENTRY_ID}...")
    history = fpl_api.get_entry_history(SEASON, FPL_ENTRY_ID)
    fpl_api.get_entry_transfers(SEASON, FPL_ENTRY_ID)  # cache only for now
    egw_rows = transform.transform_my_entry_gameweeks(history, user_id, SEASON)
    n_gw = load.upsert_my_entry_gameweeks(client, egw_rows)
    print(f"  my_entry_gameweeks loaded: {n_gw} GW rows")
    past = history.get("past", [])
    print(f"  (raw history also holds {len(past)} past-season summaries — see note below)")

    # 3. Mini-league standings (paginated, full snapshot)
    as_of_gw = entry.get("current_event")
    print(f"\n[3/4] {len(FPL_LEAGUE_IDS)} mini-league(s), as of GW{as_of_gw}...")
    for league_id in FPL_LEAGUE_IDS:
        results: list[dict] = []
        league_name = None
        page = 1
        while True:
            data = fpl_api.get_league_standings(SEASON, league_id, page)
            league_name = data.get("league", {}).get("name")
            standings = data.get("standings", {})
            results.extend(standings.get("results", []))
            if not standings.get("has_next"):
                break
            page += 1
        rows = transform.transform_my_league_standings(
            league_name, results, user_id, SEASON, league_id, as_of_gw
        )
        n = load.upsert_my_league_standings(client, rows)
        print(f"  league {league_id} '{league_name}': {n} entries loaded")

    # 4. FK note on past seasons
    # DEFERRED: past-season personal rows are cached but not loaded (my_entry FK
    # to fpl.seasons). The archive step MUST back-fill them — see the requirement
    # in ingest/archive.py's docstring and README.md.
    print(f"\n[4/4] Note: my_entry / my_entry_gameweeks are FK-bound to fpl.seasons,")
    print(f"  which currently holds only {SEASON}. Past-season personal summaries")
    print(f"  ({', '.join(p.get('season_name','?') for p in past)}) are cached in raw/")
    print(f"  but NOT DB-loaded yet — the archive step back-fills them")
    print(f"  (see ingest/archive.py). This is a tracked deferral, not a drop.")

    _verify_personal(client, user_id, history)


def _verify_personal(client, user_id: str, history: dict) -> None:
    """Scoped check: read back what landed + show past seasons from raw cache."""
    print("\n" + "=" * 60)
    print("  PERSONAL VERIFICATION")
    print("=" * 60)

    # my_entry (loaded seasons) — paginated helper (safe by default)
    me = query.fetch_all(
        client, "my_entry", "season_id, team_name, overall_points, overall_rank",
        filters={"user_id": user_id}, order="season_id",
    )
    print("\n[my_entry] DB-loaded season summaries:")
    for r in me:
        print(f"  {r['season_id']}  '{r['team_name']}'  "
              f"pts={r['overall_points']}  rank={r['overall_rank']:,}")

    # chips used this season (from loaded GW rows)
    gw = query.fetch_all(
        client, "my_entry_gameweeks", "gw_number, chip_used",
        filters={"user_id": user_id, "season_id": SEASON}, order="gw_number",
    )
    chips = [(r["gw_number"], r["chip_used"]) for r in gw if r["chip_used"]]
    print(f"\n[my_entry_gameweeks] {SEASON} chips used: "
          f"{chips if chips else 'none'}")

    # all history seasons incl. past (from raw cache — FK-blocked ones flagged)
    loaded = {r["season_id"] for r in me}
    print("\n[full history] every season FPL reports (raw cache):")
    for p in history.get("past", []):
        # season_name like '2024/25' → season_id '2024-25'
        sid = p.get("season_name", "").replace("/", "-")
        tag = "DB-loaded" if sid in loaded else "raw only (pending archive)"
        print(f"  {p.get('season_name')}  pts={p.get('total_points')}  "
              f"rank={p.get('rank'):,}   [{tag}]")

    # league standings summary — count via exact_count, then two DELIBERATELY
    # bounded reads (top-3 via .limit(3); my own row via the unique rival key).
    # We never scan the whole table: big public leagues exceed the 1000-row cap.
    fpl = client.schema("fpl")
    print("\n[my_league_standings] loaded leagues (my rank + top rivals):")
    for league_id in FPL_LEAGUE_IDS:
        base = {"user_id": user_id, "season_id": SEASON, "league_id": league_id}
        total = query.exact_count(client, "my_league_standings", filters=base)
        if not total:
            print(f"  league {league_id}: NO ROWS")
            continue
        top = fpl.table("my_league_standings") \
            .select("league_name, as_of_gw, rival_name, rival_rank, rival_total, rival_entry_id") \
            .eq("user_id", user_id).eq("season_id", SEASON).eq("league_id", league_id) \
            .order("rival_rank").limit(3).execute().data
        mine_res = fpl.table("my_league_standings") \
            .select("rival_name, rival_rank, rival_total") \
            .eq("user_id", user_id).eq("season_id", SEASON).eq("league_id", league_id) \
            .eq("rival_entry_id", FPL_ENTRY_ID).execute().data
        mine = mine_res[0] if mine_res else None
        name = top[0]["league_name"]
        gw_at = top[0]["as_of_gw"]
        print(f"\n  '{name}' (id {league_id}, {total} entries, as of GW{gw_at})")
        if mine:
            print(f"    MY RANK: {mine['rival_rank']} of {total}  "
                  f"({mine['rival_name']}, {mine['rival_total']} pts)")
        else:
            print("    MY RANK: not found (my entry not in this league snapshot)")
        for r in top:
            marker = " <- me" if r["rival_entry_id"] == FPL_ENTRY_ID else ""
            print(f"    {r['rival_rank']:>4}. {r['rival_name']:<28} "
                  f"{r['rival_total']:>5} pts{marker}")


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
