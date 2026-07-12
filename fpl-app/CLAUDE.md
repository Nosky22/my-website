# FPL Badger — Frontend

Auth-gated Fantasy Premier League analysis app at `nosky.co.uk/fpl/`.
Separate Vite project (`fpl-app/`), builds to `/fpl/`, served with `basename="/fpl"`.

## Purpose

Help Nick win FPL mini-leagues. Phases:
- **Phase 2 (current):** Hub, player explorer, insights, form tables, my-team / mini-league view, transfer planner
- **Phase 3:** Live in-season sync, fixture ticker, top-manager picks

## Route plan

```
/fpl/              Hub (auth-gated dashboard)
/fpl/login         Magic-link login
/fpl/players       Player explorer — search, filter, sort on fpl.player_gameweeks
/fpl/insights      Pre-computed insight cards (fpl.insights)
/fpl/form          Team/player form tables (fpl.team_form, fpl.player_form)
/fpl/my-team       My entry + GW history + mini-league standings
/fpl/planner       Transfer planner (2025/26 baseline)
/fpl/admin         Admin panel — admin only (fpl.is_admin())
```

## Auth requirement

All routes except `/fpl/login` require an authenticated Supabase session.
Use `fpl.is_admin()` (security definer) for admin-only gating — never check `user_metadata`.

## Supabase client

`src/lib/supabase.ts` — anon key only. Service role key is never in client code.
Schema: `fpl` (set `schema: 'fpl'` in `createClient` options when querying fpl tables, or use explicit schema prefix in RPC).

Env vars needed in `fpl-app/.env.local`:
```
VITE_SUPABASE_URL=<same as spal-app>
VITE_SUPABASE_ANON_KEY=<same as spal-app>
```

## fpl schema — table summary

| Table | Holds |
|---|---|
| `fpl.seasons` | Season metadata, data_tier (full_xg / no_xg), is_current |
| `fpl.teams` | PL team per season with strength ratings |
| `fpl.canonical_players` | Cross-season player identity via fpl_code |
| `fpl.players` | Player per season (position, team, fpl_element_id) |
| `fpl.gameweeks` | GW metadata — deadline, average/highest score, finished |
| `fpl.fixtures` | Fixture per season — kickoff, teams, score, FDR, finished |
| `fpl.player_gameweeks` | **Main fact table** — one row per player per GW: stats, xG, price, ownership |
| `fpl.team_elo` | Fishy-style ELO rating after each GW |
| `fpl.team_form` | Rolling 6/10-game form window per team |
| `fpl.player_form` | Rolling form per player — ppg, xGI/90, form_delta |
| `fpl.manager_picks` | Top-manager captain/pick captures (Phase 3) |
| `fpl.my_entry` | Nick's entry per season — overall points and rank |
| `fpl.my_entry_gameweeks` | Nick's GW-level history — points, rank, chips |
| `fpl.my_league_standings` | Mini-league standings snapshots |
| `fpl.insights` | Pre-computed insight cards — slug, title, summary, payload (jsonb), data_basis |
| `fpl.user_roles` | Admin role assignments |

**Read-only in client code.** All writes go through the Python pipeline (service role) or Netlify Edge Functions. The client never inserts or updates.

## Conventions

- **Tailwind tokens:** `fpl-bg`, `fpl-surface`, `fpl-surface-raised`, `fpl-text`, `fpl-muted`, `fpl-accent`, `fpl-accent-light`, `fpl-gold`, `fpl-error`, `fpl-success`
- **Charts:** Recharts only. Colours from CSS custom properties (not hardcoded hex).
- **Heavy pre-computation:** form, ELO, and insight payloads are computed offline by the Python pipeline and stored in the DB. The frontend reads and renders — it does not compute.
- **Data basis:** every insight card must display `data_basis` (seasons used, caveats). Don't present weak patterns as certainties.

## Dev

```bash
cd fpl-app
npm install
npm run dev       # http://localhost:5173/fpl/
npm run typecheck
npm run lint
npm run build
```
