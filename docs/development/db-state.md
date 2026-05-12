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

## Pending migrations

None.
