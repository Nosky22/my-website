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

## Deferred: past-season personal rows (archive step MUST back-fill)

`--personal` caches the manager's full entry history (`raw/<season>/entry-<id>-history.json`), whose `past` array holds prior-season overall points/rank. Those past seasons are **not** loaded into `fpl.my_entry` at personal-capture time, because `fpl.my_entry.season_id` has a foreign key to `fpl.seasons`, which only contains the current season until the archive runs.

**This is a tracked deferral, not a silent drop.** The `--archive` step (`ingest/archive.py`) **must**, after inserting each archive season into `fpl.seasons`, also back-fill the cached past-season personal rows:

1. Read the cached entry history `past` array.
2. For each past season now present in `fpl.seasons`, upsert an `fpl.my_entry` row (`overall_points` = `total_points`, `overall_rank` = `rank`; `season_name` `'2024/25'` → `season_id` `'2024-25'`).
3. Attribute to the same admin `user_id` used by `--personal`.

The requirement is documented in `ingest/archive.py`'s module docstring and flagged at runtime by `--personal`. For this manager, the deferred seasons are **2022/23, 2023/24, 2024/25**.

## Elite-manager capture & SURVIVORSHIP BIAS (must frame all manager analysis)

`--managers` captures the actions (picks, chips, transfers) of the **top 150
managers of league 314 (Overall) for 2025/26** — a one-shot capture taken before
the API resets and this data disappears. Tables: `manager_picks`,
`manager_gameweeks`, `manager_transfers`, `manager_seasons`.

**This cohort is "elite in 2025/26 only" — it is NOT a sample of durably skilled
managers.** Measured against prior seasons (excluding 2025/26 itself):

- **123 of 150 have ZERO prior top-10k finishes** — elite this season only.
- **12 are brand-new accounts** whose only-ever season is 2025/26 — including the
  world #1 (entry 3027768, rank 8.8M at GW1 → finished 1st).
- Only **27 have ≥1** and **10 have ≥2** prior top-10k finishes.

**Consequence:** read this data for **repeated patterns across the
skill-consistent sub-cohort** (`manager_seasons` → count top-10k finishes with
`season_name != '2025/26'`, filter to ≥1 or ≥2), **never for individual
outcomes**. A single manager's success is heavily confounded by luck and
regression to the mean; the signal is in what many repeat-elite managers did in
common (template timing, chip timing, transfer discipline), not in any one team.
Every manager-derived insight must state which sub-cohort it used and this caveat.

## Safe reads (1000-row cap)

PostgREST caps every row-select at **1000 rows** by default. A bare `.execute()` on a select silently returns at most the first 1000 rows. All row reads and counts go through `ingest/query.py` (`fetch_all` paginates; `exact_count` uses the count header). Never call `.execute()` on a bare row-select whose result could exceed 1000 rows — use `fetch_all`, `exact_count`, or an explicit `.order(...).limit(n)`.

## After a successful live capture

1. Run verification queries (see `data-pipeline/fpl/CLAUDE.md`)
2. Compress raw cache: `python -c "from ingest.backup import make_archive; make_archive('2025-26')"`
3. Upload `raw-2025-26.tar.gz` to Cloudflare R2

## Next season

1. Update `SEASON = "2026-27"` in `run_phase0.py`
2. Update `is_current` on the previous season row in `fpl.seasons`
3. Run `--dry-run` then `--live`
