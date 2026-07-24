#!/usr/bin/env python3
"""Pre-season loader for a NEW live season (bootstrap + fixtures only).

Reuses the Phase-0 pipeline (fpl_api / transform / load) with the season
parametrised. Loads season -> teams -> canonical_players -> players ->
gameweeks -> fixtures. NO player_gameweeks: before GW1 no per-GW performance
exists yet (that arrives via the live weekly sync once the season starts).

Idempotent (all upserts on natural keys) and cache-first (raw JSON saved under
raw/{season}/). Run again safely as the pre-season player pool fills.

    python run_newseason.py --season 2026-27
"""
from __future__ import annotations

import argparse
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from ingest import fpl_api, load, transform


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True, help="e.g. 2026-27")
    args = ap.parse_args()
    season = args.season

    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print(f"=== pre-season load: {season} ===")
    bootstrap = fpl_api.get_bootstrap(season)
    print(f"  {len(bootstrap['elements'])} players | {len(bootstrap['teams'])} teams "
          f"| {len(bootstrap['events'])} GWs | {bootstrap.get('total_players', 0):,} managers signed up")

    load.upsert_season(c, transform.transform_season(bootstrap, season))
    team_map = load.upsert_teams(c, transform.transform_teams(bootstrap, season))
    print(f"  teams upserted: {len(team_map)}")

    canonical_rows = transform.transform_canonical_players(bootstrap)
    canonical_map = load.upsert_canonical_players(c, canonical_rows)
    print(f"  canonical_players upserted: {len(canonical_map)}")

    player_rows = transform.transform_players(bootstrap, season, team_map, canonical_map)
    load.upsert_players(c, player_rows)
    print(f"  players upserted: {len(player_rows)}")

    load.upsert_gameweeks(c, transform.transform_gameweeks(bootstrap, season))
    print(f"  gameweeks upserted: {len(bootstrap['events'])}")

    fixtures_raw = fpl_api.get_fixtures(season)
    fixture_map = load.upsert_fixtures(c, transform.transform_fixtures(fixtures_raw, season, team_map))
    print(f"  fixtures upserted: {len(fixture_map)}")
    print("done.")


if __name__ == "__main__":
    main()
