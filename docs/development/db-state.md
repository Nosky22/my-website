# SPAL Database State

Running record of all migrations applied to the Supabase production database.

**Project ref:** `vtgeweowikddwrmrbhkx`  
**Project URL:** `https://vtgeweowikddwrmrbhkx.supabase.co`

---

## Applied migrations

### `001_foundation.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `seasons` | `bigint identity` | Year unique; status check constraint |
| `profiles` | `uuid` (FK → `auth.users`) | Auto-created on sign-up via trigger |
| `players` | `bigint identity` | Nation + position_group check constraints |
| `player_prices` | `bigint identity` | `final_price` generated column; unique per player/season/round |

**Functions created:**
- `update_updated_at_column()` — trigger utility, keeps `updated_at` current
- `is_admin()` — security definer, returns `true` if calling user has `profiles.is_admin = true`
- `prevent_admin_self_elevation()` — blocks non-admin from setting `is_admin = true`
- `handle_new_user()` — security definer trigger, auto-inserts a `profiles` row on `auth.users` insert

**RLS:** Enabled on all four tables. All tables: public read (`anon` + `authenticated`); admin-only write.

**Known divergence from `data-model.md`:** `is_admin` lives on `profiles` directly rather than in a separate `user_roles` table. `data-model.md` needs updating.

---

### `002_draft.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — tables and RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `draft_order` | `bigint identity` | Unique per (season, position) and (season, manager) |
| `draft_sessions` | `bigint identity` | Unique per season; `updated_at` trigger; status check constraint |
| `draft_picks` | `bigint identity` | Unique per (season, player) and (season, manager, slot); slot check constraint |

**RLS:** Enabled on all three tables. Read: `authenticated` only (not `anon` — draft data is not public). Write: admin-only except `draft_picks`, which also allows the picking manager to insert their own pick (fallback; Edge Function is the enforced path).

---

### `003_squad_scoring.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — all 8 tables and 32 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `matches` | `bigint identity` | Six Nations fixtures; unique per (season, home_nation, away_nation); public read |
| `matchday_squads` | `bigint identity` | Player starting/bench status per match; unique per (match, player); public read |
| `player_match_scores` | `bigint identity` | Player points per match; `final_points` generated column; unique per (match, player); public read |
| `manager_round_squads` | `bigint identity` | Manager's squad per round; unique per (season, profile, round); authenticated read |
| `manager_round_squad_players` | `bigint identity` | 15 starters + 1 Supersub; cascades on squad delete; partial unique indexes enforce 1 captain and 1 supersub |
| `manager_match_scores` | `bigint identity` | Computed manager score per match; stores `starters_raw_points`, `supersub_raw_points`, `supersub_multiplier_applied` separately for recalculation |
| `fixture_groups` | `bigint identity` | H2H fixtures per round; pair or triple |
| `fixture_group_members` | `bigint identity` | Managers in each H2H group; `group_place` (not `placing` — PostgreSQL keyword conflict) |

**RLS:** Enabled on all eight tables. `matches`, `matchday_squads`, `player_match_scores`: public read (`anon` + `authenticated`); admin-only write. All squad/scoring/H2H tables: `authenticated`-only read; admin-only write except `manager_round_squads` (manager can insert/update own unlocked squad) and `manager_round_squad_players` (manager can insert/delete for own non-locked squad).

**Design note:** `leagues` and `league_members` tables deliberately omitted for v0.1 (one league per season). All tables use `season_id + profile_id` directly. See `docs/adr/0005-defer-leagues-abstraction.md`.

---

### `004_standings.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — table and RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `season_standings` | `bigint identity` | One row per manager per season; unique per (season, profile); covers both total-points and H2H tables; public read |

**RLS:** Public read (`anon` + `authenticated`); admin-only write.

**Design note:** Ranks (H2H rank, total-points rank) are not stored — derived at query time via `RANK() OVER (PARTITION BY season_id ORDER BY h2h_points DESC, total_points DESC)`. W/D/L counts use `group_place` from `fixture_group_members` (1=win, 2=draw, 3=loss), applied consistently to both pairs and triples.

---

### `005_standings_last_updated_round.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — column verified by query

**Changes:** Added `last_updated_round int` (nullable) to `season_standings`. Null until the first round is finalised; set by the scoring Edge Function so the UI can display "standings after round N" without querying match data.

---

### `006_rules_admin_audit.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — all 4 tables and 12 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `season_rules` | `season_id` (FK → seasons) | No surrogate key; one ruleset per season; public read |
| `admin_overrides` | `bigint identity` | Insert-only; `entity_id` is `text` to handle both bigint and uuid PKs; authenticated read |
| `audit_log` | `bigint identity` | Insert-only; `entity_id` is `text`; authenticated read |
| `league_penalties` | `bigint identity` | Admin-applied point adjustments per manager per round; authenticated read |

**RLS:** `season_rules`: public read, admin write. `admin_overrides` and `audit_log`: authenticated read, admin insert only — no update or delete policies (insert-only by design). `league_penalties`: authenticated read, full admin write.

---

### `007_import_pipeline.sql`
**Applied:** 2026-05-12  
**Status:** Applied successfully — all 8 tables and 30 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `data_sources` | `bigint identity` | Registry of import adapters; unique name; admin-only read |
| `import_runs` | `bigint identity` | One row per import execution; `round_number` nullable for season-wide imports; admin-only read |
| `raw_import_payloads` | `bigint identity` | Insert-only; raw source data stored unchanged; admin-only read |
| `data_quality_issues` | `bigint identity` | Flagged records pending admin review; resolved via UPDATE; blocks round finalisation while unresolved; admin-only read |
| `legacy_import_files` | `bigint identity` | Uploaded 2026 workbook files; admin-only read |
| `legacy_import_sheets` | `bigint identity` | Sheets within a workbook; admin-only read |
| `legacy_import_rows` | `bigint identity` | Staged rows for admin review; status: pending → flagged/approved → promoted/rejected; admin-only read |
| `legacy_import_issues` | `bigint identity` | Quality issues per legacy row; same issue_code vocabulary as `data_quality_issues`; admin-only read |

**RLS:** All 8 tables admin-only read (`USING (is_admin())`). `raw_import_payloads`: insert-only (2 policies). All others: full admin write (4 policies).

---

### `20260513215743_extend_position_group_constraint.sql`
**Applied:** 2026-05-13  
**Status:** Applied successfully — constraint verified by query

**Changes:** Extended `players_position_group_check` to include `'Other'` alongside the original three values (`'Front Row'`, `'Back Row'`, `'Outside Back'`). Required for positions with no dedicated draft slot (Second Row, Scrum-half, Fly-half, Centre). Additive only — no data modified.

---

## Pending migrations

None.
