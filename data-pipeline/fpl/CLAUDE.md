# FPL Badger — Data Pipeline

Python ingestion pipeline. Runs offline (not part of any Netlify build).
Location: `data-pipeline/fpl/`

## Status (Phase 0)

All six seasons are loaded and verified in the `fpl` schema:

| Season | Tier | Players | player_gameweeks | Notes |
|---|---|--:|--:|---|
| 2020-21 | no_xg | 713 | 24,365 | 38 GWs |
| 2021-22 | no_xg | 737 | 25,447 | 38 GWs |
| 2022-23 | full_xg | 778 | 26,505 | **37 GWs** — GW7 blanked league-wide (Queen Elizabeth II) |
| 2023-24 | full_xg | 865 | 29,725 | 38 GWs |
| 2024-25 | full_xg | 784 | 27,283 | managers (element_type=5) excluded |
| 2025-26 | full_xg | 841 | 29,747 | live API capture |

Totals: **1,980 canonical players**, **163,072 player_gameweeks**. Personal
data (`my_entry`, `my_entry_gameweeks`, `my_league_standings`) loaded for entry
2990380, including back-filled 2022/23–2024/25 season summaries. Every season
passes DGW-reconciliation and orphan checks; xG null-rate is 0% (full_xg) /
100% (no_xg) as expected.

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
│   ├── fpl_api.py       # live FPL API client (rate-limited, cache-first)
│   ├── archive.py       # vaastav CSV archive loader + personal back-fill
│   ├── transform.py     # live raw JSON → schema-shaped dicts (+ personal)
│   ├── load.py          # idempotent Supabase upserts (service role)
│   ├── query.py         # SAFE paginated reads (fetch_all / exact_count)
│   └── backup.py        # compress raw/ into tar.gz
├── run_phase0.py        # CLI: --live --archive --personal --all --dry-run
├── verify.py            # per-season integrity suite (paginated)
├── requirements.txt
├── .env                 # gitignored
├── raw-2025-26.tar.gz   # committed compressed backup of the live capture
└── raw/                 # gitignored — raw API/CSV cache (all seasons)
    ├── 2025-26/          # bootstrap, fixtures, element-summaries, entry, leagues
    └── 20xx-xx/          # vaastav teams/players_raw/fixtures/merged_gw CSVs
```

## Safe reads — the 1000-row cap (READ THIS)

PostgREST caps every row-select at **1000 rows** by default; a bare `.execute()`
on a select silently returns at most the first 1000. This has bitten the
pipeline more than once. **All row reads and counts go through `ingest/query.py`:**
`fetch_all()` paginates; `exact_count()` uses the count header. Never call
`.execute()` on a bare row-select that could exceed 1000 rows — use `fetch_all`,
`exact_count`, or an explicit `.order(...).limit(n)`. Note `fetch_all` orders by
`id` by default; pass `order=` for tables whose PK isn't `id` (e.g. `user_roles`).

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

Key files per season (cached under `raw/{season}/`; don't re-download if present):
- `gws/merged_gw.csv` — main GW fact data (**one row per player per fixture**;
  DGWs = duplicate `(element, round)` with distinct `fixture` → matches the
  `(player_id, gw_number, fixture_id)` key exactly). `round` always == `GW`.
- `players_raw.csv` — contains `code` for canonical identity
- `teams.csv`, `fixtures.csv`

Archive-tier facts to remember:
- **Managers are `element_type=5`** (Assistant Manager chip, 2024/25+). They
  aren't footballers; `archive._is_player()` filters them from players AND
  canonical rows. Their merged_gw rows then skip as "unmapped" (expected —
  e.g. 322 skipped in 2024-25).
- **`selected_by` is null** for archive seasons — no contemporaneous
  `ranked_count` denominator exists to compute ownership %.
- **`defensive_contribution` is null** for archive seasons (2025/26-only mechanic).
- **GW7 2022-23 is a league-wide blank** (Queen Elizabeth II) — no fixtures
  carry `event=7`, so that season has 37 gameweeks. Correct, not a bug.
- `is_current=false`, `source='archive'` for all archive seasons (the seasons
  `source` CHECK allows only `live_api` / `archive` / `mixed`).

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

- Raw JSON/CSV cache in `raw/` is the primary backup (gitignored).
- The compressed `raw-<season>.tar.gz` archive is **committed to the repo** as
  the backup (R2 is not used). Regenerate with
  `python -c "from ingest.backup import make_archive; make_archive('2025-26')"`.
- The uncompressed `raw/` cache stays gitignored.

## Personal data & the season FK

`my_entry.season_id` FKs to `fpl.seasons`. `--personal` only loads the current
season; prior-season summaries from the entry-history `past` array are loaded by
`--archive` (`archive._backfill_personal`) once those seasons exist in
`fpl.seasons`. Back-filled past rows have `team_name = null` (the `past` array
carries no team name). Manager 2990380 has 2022/23–2025/26 loaded (didn't play
2020/21–2021/22).

## Verification

Run `python verify.py --season <id> [--top N]` per season — it paginates via
`ingest/query.py`, so no check is silently truncated. It reports: row counts,
top-N by points (no team filter), xG null-rates, DGW reconciliation
(`sum of per-player rows == total rows`), and orphan checks. Exit code 0 = all
integrity checks pass. Expected pattern: xG null-rate 0% for full_xg / 100% for
no_xg; DGW + orphan PASS every season.

**Known player-analysis caveat:** `players.team_id` is the end-of-season club.
A mid-season transferee's early-GW rows attribute to their destination club in
per-team rollups (`opponent_team_id` per row is still correct). Phase 1 must
flag this, not absorb it silently. See README.md for the full write-up.
