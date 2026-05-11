# SPAL Product Specification Summary

**Full spec:** `SPAL_SPEC_v0.1.md` (root of repo)  
**Status:** Draft v0.1  
**Last updated:** 2026-05-10

---

## What is SPAL?

The Sergio Parisse Appreciation League is a private standalone fantasy rugby draft league for the Men's Six Nations. It is not affiliated with Six Nations Rugby, Guinness, or Sergio Parisse.

SPAL manages a custom private competition: managers draft exclusive players, submit full weekly squads, and compete in both total-points and head-to-head standings across the Six Nations tournament.

---

## Where does it live?

```
nosky.co.uk/spal/
```

SPAL is a sub-application of the existing nosky.co.uk Netlify site. It shares hosting and the visual shell but has its own React app, routing, and Supabase backend.

---

## What SPAL provides

- User accounts for managers and one admin/commissioner.
- Annual seasons. 2026 is historical/test data; 2027 is the first intended live season.
- A linear draft with exclusive player ownership.
- Full-squad fantasy game: 15 starters + 1 Supersub per round.
- Configurable rules: positions, budget, nation limits, Captain, Supersub, Italian starter rule.
- Modular data imports from official or third-party sources.
- Admin data overrides with audit trail.
- Weekly squad submission, score calculation, H2H standings, total-points standings.
- Player, manager, draft, and historical analytics.
- Public-accessible pages: standings, history, rules (The Laws).
- Auth-required pages: draft room, squad submission, scoring.
- Guest access via private share links.
- Chronicle module for weekly write-ups, results, and league culture posts.

---

## What SPAL is not

- Not a public commercial fantasy game.
- Not affiliated with any official competition.
- Not dependent on any single external API. External feeds are data sources only.

---

## Phased delivery plan

### Phase 0 — Documentation and project setup
- `CLAUDE.md`, product spec, architecture docs, ADRs.
- Inspect existing `nosky.co.uk` CSS and plan `/spal` integration.
- No app code.

### Phase 1 — Historical 2026 prototype
Prove game logic using completed data.
- Supabase schema: seasons, players, prices, scores, draft, squads, standings.
- Auth and role model.
- Admin-created 2026 season with real manager and player data.
- Full squad builder with budget, position, and ownership validation.
- Captain and Supersub scoring.
- Total-points table and basic H2H/triple scoring.
- Admin overrides.
- Basic rules page.

### Phase 2 — Core league experience
- Live draft room with Realtime updates and pick timer.
- Draft admin controls (pause, resume, manual pick).
- Fixture generator (pair and triple H2H).
- Guest share link.
- Player and manager stats.
- History section.
- Chronicle posts.

### Phase 3 — 2027 live readiness
- Modular data source adapters.
- Import health dashboard.
- Matchday squad import.
- Price snapshots by round.
- Round lock and finalisation workflow.
- Email notifications.
- All-time table.

### Phase 4 — Polish and resilience
- Browser notifications.
- Async draft mode.
- Advanced stats dashboards.
- Data exports.
- Better mobile UI.
- Legacy archive completion.

---

## 2026 season — confirmed data

- 7 managers: Gman, Chris, TFK, Jonners, Tommy T, Nico, Laura
- Draft had 4 slots: Outside Back, Front Row, Back Row, Wales (weakest nation)
- Source: legacy spreadsheet (historical/test data, not authoritative)
- Status: completed season, used for seeding Phase 1

---

## Open questions (from spec section 29)

Key unresolved items before 2027 live season:

1. Supersub starter multiplier: 0.5x confirmed as default (from legacy spreadsheet); confirm against 2027 official rules before launch.
2. Italian starter rule position exclusions: to be confirmed by league.
3. Budget validation: use round-lock price, latest imported price, or manually finalised round price?
4. Optional Bench/Sub 5th draft slot: mandatory in some seasons, or always optional?
5. Squad lock timing: first match kickoff of round, or player-level locks?
6. CSV upload templates: required for MVP?
7. Email provider: Resend, Postmark, or other?
8. Guest link scope: season-specific or league-wide?
