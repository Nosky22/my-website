# Claude Code Workflow for SPAL

Guidelines for working with Claude Code on this project. These complement `CLAUDE.md`.

---

## Before starting any task

1. **Read `CLAUDE.md`** — always, at the start of every session.
2. **Read the relevant docs** — for the area you're working in:
   - Adding or changing game rules → `docs/product/rules.md`
   - Schema changes → `docs/architecture/data-model.md`
   - Import work → `docs/architecture/import-pipeline.md`
   - Scoring changes → `docs/architecture/scoring-engine.md`
   - Security-sensitive work → `docs/architecture/security.md`
   - Visual/UI work → `docs/architecture/visual-system.md`
3. **Read `SPAL_SPEC_v0.1.md`** for large tasks or anything involving product decisions.

---

## Explain before building

**Always describe what you are going to build before writing any code.** This applies to every task, not just large ones.

The description should include:
- What is being built and why
- Key decisions and tradeoffs
- Any files that will be created or changed
- Any questions or concerns before proceeding

Only build after the approach is confirmed.

---

## Non-negotiables (never do without explicit instruction)

- Never expose the Supabase service role key or any API token in browser-side code
- Never write directly from the browser to tables that require Edge Function validation (draft picks, squad submissions, overrides, imports, scoring)
- Never disable or weaken RLS policies
- Never skip server-side validation even if client-side validation is present
- Never commit `.env` files or secrets
- Never add a framework, library, or dependency without discussing it first

---

## Commit practices

- Commit often with clear, descriptive messages
- Each commit should represent one coherent change
- Prefer a commit per feature or fix, not per file
- Do not batch unrelated changes into one commit
- Do not amend published commits

---

## Schema changes

When changing the database schema:

1. Write a new SQL migration file in `supabase/migrations/`
2. Update `docs/architecture/data-model.md` to reflect the change
3. Update TypeScript types
4. Update RLS policies if the new table needs them
5. Note the reason for the change in the migration file comment

---

## Rules changes

When changing game rules:

1. Update `docs/product/rules.md`
2. Update `season_rules` JSON structure if the ruleset schema changes
3. Update scoring engine logic if multipliers or calculation logic changes
4. Update `docs/architecture/scoring-engine.md`
5. Add or update unit tests for the affected rule

---

## Security-sensitive changes

For any change touching auth, RLS, Edge Functions, tokens, or guest access:

1. Read `docs/architecture/security.md` first
2. Confirm the change does not expose tokens or bypass RLS
3. Test that the RLS policy works for each role (admin, manager, guest, anon)

---

## Testing

- Write unit tests for all scoring engine logic
- Write integration tests for critical Edge Function flows (draft pick, squad submission)
- Keep import regression fixtures for each data source and season
- Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` before committing

---

## Documentation updates

Update docs in the same commit as the code change when changing:
- Game rules (any `docs/product/rules.md` section)
- Database schema (any table in `docs/architecture/data-model.md`)
- Import pipeline (adapters, normalisation, issue codes)
- Scoring logic (multipliers, H2H calculation, tie handling)
- Security model (roles, RLS, Edge Functions)
- Visual tokens or component inventory

---

## Phase discipline

Each phase has a defined scope. Do not implement Phase 2+ features during Phase 1 unless explicitly instructed. If a Phase 1 task reveals something that should be noted for a later phase, record it in the relevant doc rather than implementing it early.

---

## Working with the SPAL spec

`SPAL_SPEC_v0.1.md` is the product source of truth. If implementation decisions conflict with the spec, flag the conflict rather than silently resolving it. The spec may need updating, or the implementation approach may need changing — but that decision belongs to the commissioner, not to Claude Code alone.
