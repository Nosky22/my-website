# nosky.co.uk

Personal website hosting two private apps and small public tools.

**Repo map:**
- `spal-app/` — SPAL React app (Vite/TypeScript) → builds to `/spal/`, served at `nosky.co.uk/spal/`. See `spal-app/` for its own CLAUDE context.
- `fpl-app/` — FPL Badger React app (Vite/TypeScript) → builds to `/fpl/`, served at `nosky.co.uk/fpl/`. See `fpl-app/CLAUDE.md`.
- `data-pipeline/fpl/` — Python ingestion pipeline (not part of any Netlify build). See `data-pipeline/fpl/CLAUDE.md`.
- Root `*.html` files — plain HTML public pages (index, fpl.html, fpl-my-team.html, games, etc.)
- `netlify/functions/` — shared Netlify Functions (SPAL lock-squads, FPL proxy, keep-alive)
- `supabase/` — shared Supabase project. SPAL uses the `public` schema; FPL Badger uses the `fpl` schema.

---

## 1. nosky.co.uk — personal site

Plain HTML, CSS, and JavaScript pages for games, FPL tools, and small web apps.

### Tech defaults

- **Plain HTML, CSS, JavaScript** — the default for everything unless there's a clear reason not to.
- **Phaser** — acceptable for games that need a game loop, physics, or sprite management.
- **React** — only when a project genuinely needs component-based UI. Not for simple pages.
- No build tools, bundlers, or transpilers unless a framework requires them.

### Design

- Dark theme throughout. Background near `#0f0f0f`; text near `#e0e0e0`.
- CSS custom properties for colours and repeated values.
- Keep spacing generous and typography readable.

### Code style

- Comments explain the *why*, not the *what*.
- Small functions, descriptive names. Clarity over cleverness.
- No minification in source files.

---

## 2. SPAL — `/spal/`

The Sergio Parisse Appreciation League. A private standalone fantasy rugby draft league platform hosted at `nosky.co.uk/spal/`.

See `SPAL_SPEC_v0.1.md` for the full product specification.

### Stack

- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase: Auth, Postgres, RLS, Realtime, Edge Functions
- Netlify hosting

### Non-negotiables

- SPAL owns league state. External feeds are data sources only — never the source of truth.
- Never expose API tokens or the Supabase service role key to the browser.
- Use Edge Functions for draft picks, squad submission, imports, and scoring.
- Enable and maintain Row Level Security on all exposed Supabase tables.
- Store raw import payloads and normalised canonical data separately.
- All admin overrides must be audited with reason, old value, and new value.
- Update relevant docs when changing rules, schema, imports, scoring, security, or visual tokens.

### Database non-negotiables

- **Before running any migration:** state clearly what it will do and explicitly identify what is irreversible (dropped columns, deleted data, constraint changes that cannot be rolled back).
- **After running any migration:** query the database to confirm that every table, column, and RLS policy exists as expected. Do not report success without verification.
- **Never re-run a migration that has already been applied.** Check what currently exists in the database before executing any DDL.
- **If a migration fails partway through:** stop immediately and report the exact error. Do not attempt any fix until the failure is understood and communicated.
- **Keep `docs/development/db-state.md` up to date** with every migration applied: file name, date, and tables affected.

### Key docs

- Product spec: `docs/product/spal-spec.md`
- Game rules: `docs/product/rules.md`
- User journeys: `docs/product/user-journeys.md`
- League culture: `docs/product/league-culture.md`
- Legacy sources: `docs/product/legacy-sources.md`
- Architecture: `docs/architecture/spal-architecture.md`
- Data model: `docs/architecture/data-model.md`
- Import pipeline: `docs/architecture/import-pipeline.md`
- Scoring engine: `docs/architecture/scoring-engine.md`
- Security: `docs/architecture/security.md`
- Visual system: `docs/architecture/visual-system.md`
- Claude Code workflow: `docs/development/claude-code-workflow.md`
- Database state: `docs/development/db-state.md`

### Verification (once app code exists)

```
npm run typecheck
npm run lint
npm run test
npm run build
```

---

## 3. FPL Badger — `/fpl/`

Private, auth-gated Fantasy Premier League analysis tool. Primary goal: help win mini-leagues. Single user (Nick) for now, built multi-user-ready.

### Stack

- Vite + React + TypeScript (separate `fpl-app/` project)
- Tailwind CSS (fpl.* token namespace)
- Recharts for data visualisation
- Supabase `fpl` schema (same project as SPAL) — Auth, Postgres, RLS
- Python data pipeline in `data-pipeline/fpl/` (offline, not in the Netlify build)

### Ground rules

- **Never touch `spal-app/`** unless explicitly asked.
- Service role key, FPL session cookie, and all credentials live only in `.env` files (gitignored) or Netlify env vars. Never in client code, never committed.
- Feature branches `feature/fpl-*`, conventional commits (`feat:`, `fix:`, `chore:`).
- Every insight records its data basis and sample-size caveats — no confident presentation of weak patterns.
- TypeScript strict, ESLint/Prettier, indexed queries, pre-compute heavy work offline.
- Before running any schema change: state what it does and what is irreversible. Verify after.

### Verification

```
cd fpl-app && npm run typecheck && npm run lint && npm run build
```

---

## Workflow (all parts of the repo)

- **Always explain what you're building before writing any code.** Describe the approach and ask if it sounds right.
- Prefer editing existing files over creating new ones when extending a feature.
- Don't introduce abstractions until the same pattern appears at least three times.
- No frameworks, libraries, or dependencies added without explicit discussion.
- Commit often with clear messages. Do not add Co-Authored-By trailers to commit messages.
- Read `CLAUDE.md` and relevant docs before starting any task.
