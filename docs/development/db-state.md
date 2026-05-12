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

## Pending migrations

None.
