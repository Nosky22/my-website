# FPL Badger — Data Pipeline

Python ingestion pipeline. Runs offline (not part of any Netlify build).
Location: `data-pipeline/fpl/`

## Setup

```bash
cd data-pipeline/fpl
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Secrets in `data-pipeline/fpl/.env` (gitignored — verify before writing any secret):
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
FPL_ENTRY_ID=
FPL_LEAGUE_IDS=          # comma-separated classic league IDs
FPL_SESSION_COOKIE=      # only if needed for 403 on personal endpoints
```

## Module layout

```
data-pipeline/fpl/
├── ingest/
│   ├── __init__.py
│   ├── fpl_api.py       # FPL API client with rate limiting and cache
│   ├── archive.py       # vaastav GitHub archive downloader
│   ├── transform.py     # raw → schema-shaped dicts
│   ├── load.py          # idempotent Supabase upserts (service role)
│   └── backup.py        # compress raw/ into tar.gz for R2
├── run_phase0.py        # CLI entrypoint: --live --archive --personal --all --dry-run
├── requirements.txt
├── .env                 # gitignored
└── raw/                 # gitignored — raw API response cache
    └── 2025-26/
        └── ...
```

## FPL API

Base URL: `https://fantasy.premierleague.com/api/`

Key endpoints:
- `bootstrap-static/` — teams, players (elements), gameweeks, settings. Player `code` = cross-season identity → `fpl.canonical_players.fpl_code`
- `fixtures/` — all fixtures for current season
- `element-summary/{element_id}/` — per-player GW history (~700 calls per season)
- `entry/{entry_id}/` and `entry/{entry_id}/history/` — my entry + GW history
- `entry/{entry_id}/transfers/` — my transfer history
- `leagues-classic/{league_id}/standings/` — mini-league standings (paginated)

### Rate limiting

- Max ~1 request/second to FPL API
- Exponential backoff with jitter on 429/5xx (use `tenacity`)
- Cache EVERY raw API response as JSON under `raw/{season}/` before transforming
- Cache-first: if the raw file exists, skip the network call (resume-safe)

## vaastav archive

Repo: `https://github.com/vaastav/Fantasy-Premier-League`
Per-season data under `data/{season}/` — download via raw.githubusercontent.com.

Seasons and data tiers:
- 2022-23, 2023-24, 2024-25 → `full_xg` (xG/xA/xGI/xGC present)
- 2020-21, 2021-22 → `no_xg` (leave xG columns null)

Key files per season:
- `gws/merged_gw.csv` — main GW fact data
- `players_raw.csv` — contains `code` for canonical identity
- `teams.csv`, `fixtures.csv`

Cache downloaded files locally; don't re-download if already present.

## Load order (per season)

`seasons → teams → canonical_players → players → gameweeks → fixtures → player_gameweeks`

## Idempotent upsert keys

| Table | Natural key |
|---|---|
| `fpl.seasons` | `id` (text: '2025-26') |
| `fpl.teams` | `(season_id, fpl_team_id)` |
| `fpl.canonical_players` | `fpl_code` |
| `fpl.players` | `(season_id, fpl_element_id)` |
| `fpl.gameweeks` | `(season_id, gw_number)` |
| `fpl.fixtures` | `(season_id, fpl_fixture_id)` |
| `fpl.player_gameweeks` | `(player_id, gw_number, fixture_id)` |
| `fpl.my_entry` | `(user_id, season_id)` |
| `fpl.my_entry_gameweeks` | `(user_id, season_id, gw_number)` |
| `fpl.my_league_standings` | `(user_id, season_id, league_id, as_of_gw, rival_entry_id)` |

All upserts use the service role key (bypasses RLS). Re-running is always safe.

## Backup policy

- Raw JSON cache in `raw/` is the primary backup (gitignored; back up to Cloudflare R2)
- After a successful Phase 0 run, produce `raw-2025-26.tar.gz` and upload to R2
- Do not commit raw data if it exceeds ~100 MB total

## Verification (run and show output after Phase 0)

1. Row counts per table per season (expect ~38 GWs, 20 teams, ~700 players, ~20k–25k player_gameweeks)
2. Top 5 players by total points in 2025/26 — verify against known results
3. Null rate on xG columns: near-zero for full_xg seasons, 100% for no_xg seasons
4. My personal history: seasons present, chips used, final ranks
5. Orphan check: player_gameweeks rows with no matching player/fixture = 0
