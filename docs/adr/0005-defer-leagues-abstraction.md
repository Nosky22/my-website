# ADR 0005 — Defer the leagues abstraction for v0.1

**Status:** Accepted  
**Date:** 2026-05-12

---

## Context

The `data-model.md` design includes `leagues` and `league_members` tables as first-class concepts. Squad, draft, and scoring tables reference `league_id` and `league_member_id` rather than `season_id` and `profile_id` directly.

This abstraction exists to support a future scenario where multiple independent leagues could run within the same season — each with its own draft, squads, fixture schedule, and standings.

For SPAL v0.1:
- There is exactly one league per season
- All 7 managers are always members
- There is no multi-tenancy requirement
- The leagues abstraction adds join depth and complexity with no concrete benefit

The draft tables in Layer 2 (`002_draft.sql`) were implemented using `season_id + profile_id` directly. Introducing `league_id` in Layer 3 while Layer 2 has no such column would create an inconsistent schema.

---

## Decision

Omit `leagues` and `league_members` entirely for v0.1. All squad, scoring, and H2H tables use `season_id + profile_id` directly — the same pattern established by the Layer 2 draft tables.

This is a deliberate simplification, not an oversight. The decision is reviewed when multi-league support becomes a concrete requirement.

---

## Consequences

**Positive:**
- Simpler schema, simpler queries, simpler RLS policies
- Consistent with the draft layer — one join pattern throughout
- No orphaned abstraction with no real instances

**Negative / constraints:**
- Adding multi-league support later will require a migration rather than a config change
- `data-model.md` describes the deferred state — keep it as the target design, not the current schema

**What would need to change to support multiple leagues per season:**

1. **New tables:** `leagues` (season_id, name, status, commissioner_id) and `league_members` (league_id, profile_id, draft_position, ...)

2. **Layer 2 tables to update:** `draft_order`, `draft_sessions`, `draft_picks` — add `league_id` FK; scoped queries and RLS would filter by league membership

3. **Layer 3 tables to update:** `manager_round_squads`, `manager_match_scores`, `fixture_groups`, `fixture_group_members` — replace or supplement `season_id` with `league_id`; replace `profile_id` references with `league_member_id` where appropriate

4. **RLS:** Read policies on authenticated-only tables would need to check league membership rather than just `authenticated`

5. **Application layer:** Every query that currently scopes by `season_id` would need a `league_id` context; Edge Functions would need to accept and validate it

6. **Fixture generator:** Currently assigns fixtures for all managers in a season; would need to scope to a league's member list
