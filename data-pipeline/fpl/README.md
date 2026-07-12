# FPL Badger — Data Pipeline

Python ingestion pipeline for FPL Badger. Runs offline; not part of any Netlify build.

## Setup

```bash
cd data-pipeline/fpl
/opt/homebrew/bin/python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `.env` (gitignored) with:

```
SUPABASE_URL=https://vtgeweowikddwrmrbhkx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key — never commit>
FPL_ENTRY_ID=2990380
FPL_LEAGUE_IDS=446132,406021,600361
```

## Running Phase 0

All commands from `data-pipeline/fpl/`:

```bash
# Verify one player end-to-end before a full run
python run_phase0.py --dry-run

# Full 2025/26 live capture (~700 API calls, ~15 min)
python run_phase0.py --live

# Cache personal entry, GW history, league standings
python run_phase0.py --personal

# vaastav archive (2020/21 – 2024/25) — implement Phase 0 step 3
python run_phase0.py --archive

# All of the above in order
python run_phase0.py --all
```

Raw JSON is cached to `raw/{season}/` before each upsert. Re-running is safe: all upserts are idempotent on natural keys. If a run is interrupted, restart from `--live` — cached files are reused and already-upserted rows are no-ops.

## Load order

`seasons → teams → canonical_players → players → gameweeks → fixtures → player_gameweeks`

## Ownership percentage

`selected_by` is computed as `selected / ranked_count * 100` where `ranked_count` is taken from the bootstrap `events[gw_id].ranked_count` field — the number of managers who had submitted a team by that GW's deadline.

**Do not use `total_players` (end-of-season count) as the denominator.** At GW1 of 2025/26, `ranked_count` was ~9.5 M while `total_players` at season end was ~13.1 M — a 38% difference that would systematically understate early-GW ownership figures.

## Known limitation: mid-season club transfers

`fpl.players.team_id` stores the player's **end-of-season club** as recorded in the bootstrap-static snapshot captured at the time of ingestion. It is not updated if a player transferred clubs during the season.

**Consequence for per-team analysis:** a player who moved clubs in the January window will have their entire season's `player_gameweeks` rows (including pre-transfer GWs) attributed to their end-of-season club when joining via `players.team_id`. The per-row `opponent_team_id` is correct for each fixture, but the player's own team attribution is wrong for early-GW rows.

**Scale:** small — typically 5–15 outfield players per season move in January.

**Phase 1 requirement:** any per-team aggregation (e.g. "Man City xG by GW") must flag this caveat in the UI and in any exported insight. Do not silently absorb transferred players into their destination club's full-season totals.

**Workaround (future):** `canonical_players.fpl_code` is stable across seasons. A separate `player_team_history` table keyed on `(player_id, from_gw, to_gw, team_id)` could track club tenure, but this requires manual curation or a dedicated vaastav lookup.

## After a successful live capture

1. Run verification queries (see `data-pipeline/fpl/CLAUDE.md`)
2. Compress raw cache: `python -c "from ingest.backup import make_archive; make_archive('2025-26')"`
3. Upload `raw-2025-26.tar.gz` to Cloudflare R2

## Next season

1. Update `SEASON = "2026-27"` in `run_phase0.py`
2. Update `is_current` on the previous season row in `fpl.seasons`
3. Run `--dry-run` then `--live`
