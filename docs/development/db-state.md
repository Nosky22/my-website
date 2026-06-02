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

### `20260514173933_add_anon_read_draft_picks.sql`
**Applied:** 2026-05-14  
**Status:** Applied successfully — policy verified by query

**Changes:** Added `draft_picks_anon_read` SELECT policy for the `anon` role on `draft_picks`. Required for public-facing pages (players, draft board, standings) to display draft data without login. The original authenticated-only read policy remains; this is additive.

---

### `010_draft_pick_deadline.sql`
**Applied:** 2026-05-17
**Status:** Applied successfully — column verified by query

**Changes:** Added `pick_deadline timestamptz` (nullable) to `draft_sessions`. Set by the Edge Function to `now() + pick_timer_seconds` on each pick; drives the countdown timer in all connected clients. Null until the draft goes active. Additive only.

---

### `011_realtime_publication.sql`
**Applied:** 2026-05-17
**Status:** Applied successfully — both tables verified in `pg_publication_tables`

**Changes:** Added `draft_picks` and `draft_sessions` to the `supabase_realtime` publication. Required for Realtime `postgres_changes` subscriptions to receive INSERT/UPDATE events — without this, the draft room board and session state never updated live. No schema changes; no data modified.

---

### `012_merge_profiles_fn.sql`
**Applied:** 2026-05-17 (approx — applied outside CLI tracking; repair recorded 2026-05-27)
**Status:** Applied successfully

**Changes:** Created `public.merge_profiles(placeholder_id uuid, real_id uuid, admin_id uuid) RETURNS jsonb` — a security definer function (service role only) that atomically reassigns all profile-keyed rows from a placeholder account to a real account, copies display_name and team_name, deletes the placeholder profile, and writes an audit log entry. Callable only by the service role (Edge Functions); REVOKE from PUBLIC and authenticated, GRANT to service_role.

---

### `013_seasons_status_add_active.sql`
**Applied:** 2026-05-17 (approx — applied outside CLI tracking; repair recorded 2026-05-27)
**Status:** Applied successfully

**Changes:** Extended `seasons_status_check` constraint to include `'active'` alongside `setup`, `historical`, `live`, `complete`. Required for the dashboard to identify the current season via `status = 'active'`. Additive only — no data modified.

---

### `014_canonical_players.sql`
**Applied:** 2026-05-27
**Status:** Applied successfully — all three post-migration checks passed

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `canonical_players` | `bigint identity` | Stable real-world player identity across seasons; unique per (display_name, nation); public read, admin write |

**Columns added:**
- `players.canonical_player_id` — `bigint nullable FK → canonical_players(id)`. All existing rows linked on apply (0 unlinked after migration). NOT NULL constraint deferred to migration 015.

**Extensions enabled:**
- `unaccent` (in `extensions` schema) — used to compute `search_name` as `lower(extensions.unaccent(display_name))`

**Data populated:** 127 canonical player records created from existing `players` data. Dedup key: `(display_name, nation)`. Position taken from most recent season per player. All 127 unique players confirmed linked (0 unlinked rows).

**Indexes added:** `canonical_players_search_name_idx`, `canonical_players_nation_idx`, `players_canonical_player_id_idx`

**RLS:** 5 policies on `canonical_players` — SELECT for anon + authenticated; INSERT/UPDATE/DELETE for authenticated with `is_admin()` check.

**Migration history note:** Migrations 011–013 and 20260514173933 were applied to the database prior to CLI tracking being set up. They were registered via `supabase migration repair --status applied` on 2026-05-27 so that future `db push` operations track correctly.

---

### `015_draft_picks_replica_identity.sql`
**Applied:** 2026-05-27
**Status:** Applied successfully — `relreplident = 'f'` verified by query

**Changes:** `ALTER TABLE public.draft_picks REPLICA IDENTITY FULL`. Required for Supabase Realtime filtered DELETE subscriptions to work on `draft_picks`. With `REPLICA IDENTITY DEFAULT`, Postgres only writes the primary key to WAL on DELETE; the `season_id=eq.X` filter in `useDraftPicks` couldn't be evaluated and DELETE events were silently dropped. FULL writes all column values on DELETE, enabling the filter to be evaluated server-side and the event delivered to the correct subscriber. No schema changes; no data modified.

---

### `016_seasons_add_test_status.sql`
**Applied:** 2026-05-27
**Status:** Applied successfully — constraint verified by query

**Changes:** Extended `seasons_status_check` to include `'test'` alongside the existing five values. New allowed values: `setup`, `test`, `active`, `live`, `complete`, `historical`. Implemented by dropping and recreating the constraint — no data modified, no rows affected.

---

### `017_invite_tokens.sql`
**Applied:** 2026-05-29
**Status:** Applied successfully — table, 3 policies, and function verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `invite_tokens` | `bigint identity` | Unique token; `created_by` FK → profiles; `claimed_by` FK → profiles nullable |

**Functions created:**
- `claim_invite_token(p_token text, p_user_id uuid) RETURNS boolean` — security definer; verifies profile exists then atomically marks token claimed. Callable by `anon` + `authenticated`. Used by signup flow when no session is available (email confirmation on).

**RLS:** 3 policies — admin full CRUD (`is_admin()`); `anon` SELECT on unclaimed rows (`claimed_by IS NULL`); `authenticated` UPDATE for claiming own token only (`WITH CHECK (claimed_by = auth.uid())`).

**Additive only** — no existing tables modified.

---

### `018_anon_read_manager_match_scores.sql`
**Applied:** 2026-06-01
**Status:** Applied successfully — policy `manager_match_scores_anon_read` verified by query

**Changes:** Added `manager_match_scores_anon_read` SELECT policy for the `anon` role on `manager_match_scores`. Required for public history pages (season review, all-time records) to display round-by-round and per-manager scoring without login. Score history contains no PII. The existing `authenticated`-only SELECT and admin write policies are unchanged. Additive only.

---

### `019_predos.sql`
**Applied:** 2026-06-01
**Status:** Applied successfully — all 3 tables and 9 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `predo_predictions` | `bigint identity` | One row per manager per match; unique per (profile_id, match_id); `predicted_margin >= 0` check; `updated_at` trigger |
| `predo_results` | `bigint identity` | One row per match (entered by admin); unique on `match_id`; `actual_margin >= 0` check; `updated_at` trigger |
| `predo_scores` | `bigint identity` | Calculated per manager per round; unique per (season_id, profile_id, round_number); all points columns `numeric(5,1)` to support 0.5 tie-sharing increments; `updated_at` trigger |

**RLS:**
- `predo_predictions`: managers always see own rows (`authenticated` SELECT WHERE `auth.uid() = profile_id`); everyone sees all predictions after first kickoff of the round has passed (`anon + authenticated` SELECT with `kickoff_at <= now()` subquery); managers can INSERT/UPDATE own only before deadline (same subquery negated); admin full access.
- `predo_results`: public read (`anon + authenticated`); admin write only.
- `predo_scores`: public read (`anon + authenticated`); admin write only.

**Additive only** — no existing tables modified.

---

### `020_insights.sql`
**Applied:** 2026-06-01
**Status:** Applied successfully — table and 2 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `round_insights` | `bigint identity` | One row per (season, round); `payload jsonb` holds all insight data; unique per (season_id, round_number); public read |

**RLS:**
- `round_insights_public_read`: public SELECT (`anon + authenticated`).
- `round_insights_admin_write`: admin full access (`is_admin()`).

**Additive only** — no existing tables modified.

---

### `021_chronicle.sql`
**Applied:** 2026-06-01
**Status:** Applied successfully — both tables and 6 RLS policies verified by query

**Tables created:**

| Table | Primary key | Notes |
|-------|-------------|-------|
| `chronicle_posts` | `bigint identity` | Slug unique; `published boolean`; body stored as markdown; `updated_at` trigger |
| `chronicle_comments` | `bigint identity` | `parent_id` self-referential FK (ON DELETE CASCADE); one level of replies only; `updated_at` trigger |

**RLS:**
- `chronicle_posts`: public SELECT where `published = true`; admin full access.
- `chronicle_comments`: public SELECT where post is published; authenticated INSERT (own author_id, published post, replies limited to one level); authenticated DELETE own comments (replies cascade); admin full access.

**Additive only** — no existing tables modified.

---

### `022_chronicle_fix_rls_recursion.sql`
**Applied:** 2026-06-02
**Status:** Applied successfully — both functions (prosecdef=true) and all 4 chronicle_comments policies verified by query

**Changes:** Fixed infinite recursion in `chronicle_comments` RLS policies.

**Functions created:**
- `is_post_published(p_post_id bigint) RETURNS boolean` — security definer; checks `chronicle_posts.published = true` without triggering RLS on that table.
- `is_top_level_comment(p_comment_id bigint) RETURNS boolean` — security definer; checks that a comment has `parent_id IS NULL` without re-entering `chronicle_comments` RLS.

**Policies replaced (drop + recreate):**
- `chronicle_comments_public_read` — now uses `is_post_published(post_id)` instead of an inline EXISTS subquery on `chronicle_posts`.
- `chronicle_comments_manager_insert` — now uses `is_post_published(post_id)` and `is_top_level_comment(parent_id)` instead of inline subqueries.

**No data modified. No irreversible changes.**

---

## Pending migrations

None.
