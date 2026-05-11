# Sergio Parisse Appreciation League (SPAL) - Build Specification v0.1

**Project name:** Sergio Parisse Appreciation League  
**Short name:** SPAL  
**Proposed route:** `https://nosky.co.uk/spal/`  
**Status:** Draft specification v0.1  
**Primary use:** Input brief for Claude Chat, Claude Code, and future development work  
**Last updated:** 2026-05-10

---

## 0. Journey so far: how the concept evolved

This project began as a way to preserve and extend a private fantasy rugby competition built around the official Guinness Fantasy Six Nations Men's game. The initial assumption was that SPAL would remain heavily dependent on the official website: managers would select squads on the official game, the app would record draft restrictions and league standings, and official data would be pulled from the available fantasy API where possible.

The discussion then moved through several stages:

1. **Companion app concept**  
   The first model was a private companion layer. The official site would remain the source of truth for full squads, budgets, Captain, Supersub, and official fantasy scoring. SPAL would manage the private draft, player exclusivity, league tables, and community views.

2. **Draft and league rules clarified**  
   The private league rules were defined in more detail: managers draft a small number of exclusive players, no other manager may select those drafted players, the league uses both total-points and head-to-head standings, and odd-number manager leagues use one rotating triple fixture per gameweek.

3. **Full-squad scoring introduced**  
   The scoring boundary changed. Instead of scoring only drafted players, SPAL should score each manager's full fantasy squad: 15 starters plus 1 Supersub. This meant SPAL needed a proper squad builder, budget validation, Captain/Supersub handling, and match-by-match scoring.

4. **Standalone app direction**  
   The project then moved away from relying on managers to use the official app as the operational source of truth. The target became a standalone private fantasy game: SPAL owns squads, draft rights, scoring, fixtures, standings, history, and admin workflows. The official feed remains important, but only as a data source.

5. **Modular data-source approach**  
   To avoid being tightly coupled to any official API or website that may change in future seasons, SPAL should use a modular adapter architecture. External sources are imported, normalised, stored with raw payloads, reviewed, and overridable by an admin. The app should still function if a feed changes, partially fails, or must be replaced by CSV/manual input.

6. **Legacy context added**  
   A 2026 spreadsheet and the older Wix website provide useful context for rules, historical standings, draft traditions, weekly squad views, stat tracking, and the league's tone. They are **not authoritative**, but they show what SPAL should preserve: the league's culture, annual archive, weekly storytelling, draft boards, performance stats, and light-hearted Sergio mythology.

7. **Final direction for v0.1**  
   SPAL is now specified as a private standalone fantasy rugby draft game hosted under `nosky.co.uk`, powered by Supabase, with modular imports, configurable rules, admin overrides, historical archive, stats, Chronicle/blog-style updates, secure accounts, guest views, and a design system that can reuse the existing `nosky.co.uk` visual style where appropriate.

---

## 1. Product summary

SPAL is a private standalone fantasy rugby draft league platform for the Men's Six Nations. It manages a custom private competition inspired by the official fantasy game while preserving the league's history and culture.

SPAL should provide:

- User accounts for managers and admins.
- A private league hosted at `/spal` on `nosky.co.uk`.
- Annual seasons, beginning with 2026 as historical/test data and 2027 as the first intended live season.
- A linear draft with exclusive ownership of selected players.
- A full-squad fantasy game: 15 starters plus 1 Supersub.
- Budget constraints mirroring the official game where possible.
- Configurable official-like rules: positions, budget, max players by nation, Captain, Supersub.
- Configurable SPAL-specific rules: draft ownership, Italian starter rule, weakest nation slot, triple H2H fixtures.
- Imported official or third-party rugby data where available.
- Admin data overrides and audit history.
- Weekly squad submission, score calculation, H2H standings, total-points standings.
- Player, manager, draft, and historical analytics.
- Public/guest-friendly history, rules, standings, and Chronicle pages.

The app should not present itself as official, affiliated with Six Nations Rugby, Guinness, or Sergio Parisse.

---

## 2. Goals and non-goals

### 2.1 Goals

- Build a private, maintainable fantasy rugby game for SPAL.
- Reduce operational reliance on the official fantasy website while continuing to use official feed data when available.
- Make the league's rules explicit, testable, and configurable.
- Support 2026 historical data import and future annual competitions.
- Preserve the culture and history of the previous spreadsheet/Wix-managed league.
- Make weekly league administration easier: imports, squad locks, score review, finalisation, results publication.
- Provide strong stats and historical views.
- Keep the architecture modular enough that individual data sources, scoring rules, visual components, or notification providers can be changed without rewriting the app.

### 2.2 Non-goals for early versions

- Building a public commercial fantasy game.
- Recreating every official game feature if it adds too much complexity.
- Guaranteeing exact official scoring if official feed data is unavailable or ambiguous.
- Scraping or exposing private external data in a way that creates legal or security risk.
- Migrating every historic Wix page perfectly in v0.1.
- Building a fully custom raw-stat scoring engine before the official-score import path is working.

---

## 3. Relationship to nosky.co.uk

SPAL will be accessible as a section of the existing `nosky.co.uk` website.

Recommended route:

```text
/spal/
```

The SPAL section should feel like part of `nosky.co.uk` but have enough visual richness for league tables, draft boards, squad builders, stats dashboards, and historical archive pages.

### 3.1 Hosting options

Preferred approach:

```text
Single site / monorepo or existing project
nosky.co.uk/spal/
Netlify hosting
Supabase backend
```

Alternative later:

```text
Separate SPAL app deployed separately and routed/proxied under /spal
```

### 3.2 Visual relationship

The existing `nosky.co.uk` CSS should be inspected before implementation. SPAL should reuse site-level visual tokens where appropriate, but may introduce a distinct SPAL theme layer.

Recommended direction:

```text
nosky.co.uk handmade/personal-site shell
+ SPAL rugby clubhouse/stat-dashboard theme
```

---

## 4. Target stack

### 4.1 Front end

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui where useful
- React Router or equivalent route structure
- Charting library to be chosen later for stats dashboards

### 4.2 Hosting

- Netlify
- Route under `nosky.co.uk/spal/`

### 4.3 Backend

- Supabase Auth
- Supabase Postgres
- Supabase Row Level Security
- Supabase Realtime
- Supabase Edge Functions
- Supabase Storage if needed for uploaded files, legacy spreadsheet uploads, screenshots, exports, or import artefacts

### 4.4 Data ingestion

Initial:

- Python or TypeScript ingestion scripts based on the available official fantasy feed/API method where possible.
- CSV/manual upload support.
- Legacy spreadsheet import adapter for the 2026 workbook.

Later:

- Supabase scheduled functions or external scheduled jobs.
- Additional source adapters for future feeds or licensed data providers.

### 4.5 Notifications

Initial:

- In-app notifications.
- Email provider to be chosen, likely Resend or Postmark.

Later:

- Browser push notifications where useful.
- Optional messaging integrations if desired.

---

## 5. Core product concepts

### 5.1 Season

A year-specific competition, e.g. 2026, 2027, 2028.

Each season has:

- Competition year.
- Status: setup, historical, live, complete.
- Ruleset.
- Player pool.
- Fixtures/matches.
- Prices.
- Imported scores.
- Draft and league data.

### 5.2 League

A private SPAL league for a given season. The default expectation is one main league per season, but the system should not make that impossible to extend.

### 5.3 Manager

A logged-in user participating in a league.

A manager has:

- Profile.
- Team name.
- Draft position.
- Drafted players.
- Weekly submitted squads.
- Scores and historical records.

### 5.4 Drafted player ownership

Drafted players are exclusive. If a manager drafts a player, no other manager may select that player in their SPAL squad for the rest of the tournament, unless an admin overrides a rule or corrects a mistake.

Managers may select:

- Their own drafted players.
- Any undrafted players.

Managers may not select:

- Players drafted by another manager.

### 5.5 Full squad

Each manager submits a full squad each round:

```text
15 starting players
1 Supersub
```

The full squad is selected in SPAL. SPAL is the source of truth for the private league squad, even if official feed data is used for player prices, positions, and scoring.

### 5.6 Official feed relationship

The official fantasy feed or website is not the operational source of truth for SPAL. It is a data source.

SPAL imports:

- Player list.
- Positions.
- Nations.
- Prices.
- Fixtures.
- Matchday squads/statuses, if available.
- Player fantasy scores.
- Stat breakdowns, if available.

SPAL stores, normalises, validates, and can override that data.

---

## 6. Users, roles, and permissions

### 6.1 Roles

#### Admin / Commissioner

Can:

- Create seasons and leagues.
- Configure rules.
- Invite managers.
- Enter previous-year standings.
- Generate or edit draft order.
- Start, pause, resume, reset, or manually adjust draft.
- Run imports.
- Review data quality issues.
- Override player data, prices, match statuses, and scores.
- Apply penalties.
- Finalise rounds.
- Publish Chronicle posts.
- Manage guest links.

#### Manager

Can:

- Sign in.
- View league information.
- Participate in draft.
- Submit own squad before lock.
- View all league tables, stats, player data, rules, history, and Chronicle posts permitted to managers.
- Receive notifications.

Cannot:

- Edit another manager's squad.
- Run imports.
- Override data.
- Change rules.
- Access private tokens, raw import payloads, or admin-only audit data.

#### Guest viewer

Accesses via private guest link.

Can view:

- Dashboard.
- Standings.
- Fixtures.
- Draft board.
- Player ownership.
- Stats.
- History.
- The Laws.
- Chronicle posts marked guest-visible.

Cannot:

- Sign in as a manager.
- Edit anything.
- See email addresses.
- See admin notes, raw imports, tokens, or private audit data.

#### System service

Server-side role used for imports, scoring recalculation, email sending, and scheduled jobs. Must not be exposed to the browser.

---

## 7. Locked game rules

### 7.1 Draft rules

- Draft type: linear.
- Draft order: reverse order of previous year's standings.
- Draft order is input and controlled by admin.
- Managers can fill required draft slots in any order.
- One real player can only be drafted by one manager.
- Max 4 drafted players from one nation per manager.
- Default pick timer: 2 minutes.
- Timer is admin-configurable.
- Live draft is required.
- Asynchronous draft mode should be supported later.
- "On the clock" emails should be sent only for asynchronous drafts, not live drafts.

### 7.2 Draft slots

Each manager drafts 4 or 5 players:

Required:

1. Front Row.
2. Back Row.
3. Outside Back.
4. Weakest nation player, currently Wales, any position.

Optional:

5. Bench/Sub draft pick - any player who is not in a Gameweek 1 starting XV at the time of the draft.

The weakest nation must be configurable by season.

The optional Bench/Sub rule must be evaluated based on available information at draft time. It should not be retrospectively invalidated if later team news changes unless admin explicitly chooses to correct it.

### 7.3 Draft slot assignment

A player may be eligible for multiple slots.

Example:

```text
Welsh Back Row player
Eligible for:
- Back Row
- Weakest Nation
- Bench/Sub if not in Gameweek 1 starting XV at draft time
```

The manager must choose which draft slot the pick satisfies.

### 7.4 Squad rules

Each round, each manager submits:

```text
15 starting players
1 Supersub
```

The squad must satisfy official-like constraints where configured:

- Budget limit.
- Position requirements.
- Max players per nation.
- Captain selection.
- Supersub selection.
- Italian starter rule, if enabled.
- Draft ownership restrictions.

### 7.5 Budget rules

- Budget constraints should mirror the official game where possible.
- Player prices should be imported from the official feed where available.
- Admin must be able to override prices.
- Budget limit must be configurable by season.
- Price snapshots by round should be supported, as official prices may change.
- Squad submission should normally use the applicable round's final price.

Default assumption until verified for each season:

```text
Budget enabled: true
Budget limit: imported official limit, expected around 200 stars if matching recent official game
```

### 7.6 Position rules

SPAL should support official-like squad positions.

Likely starter structure:

```text
2 Props
1 Hooker
2 Second Rows
3 Back Rows
1 Scrum-half
1 Fly-half
2 Centres
3 Outside Backs / Back Three
```

Supersub:

```text
1 player, any position
```

These should be configured as data, not hard-coded.

### 7.7 Max players per nation

Squads should support a configurable max players per nation rule.

Default:

```text
Max 4 players from one nation
```

This rule should apply to full squads unless the season rules specify otherwise.

There is also a separate draft-specific max 4 drafted players from one nation.

### 7.8 Italian starter rule

The Italian starter rule is a configurable SPAL rule.

Default proposed structure:

```json
{
  "enabled": true,
  "required_starters": 1,
  "nation": "Italy",
  "applies_to": "starting_xv",
  "excluded_positions": [],
  "admin_override_allowed": true
}
```

Notes:

- The rule reflects the historic league culture and the Sergio Parisse identity.
- The exact exception details, if any, should remain configurable.
- If the league wants to exclude certain positions such as Scrum-half or Fly-half, this should be done through `excluded_positions` rather than code changes.

### 7.9 Captain rule

- Each submitted squad must have exactly one Captain.
- Captain must be one of the 15 starters.
- Captain multiplier: x2.
- Captain selection is made in SPAL and should be treated as the private league source of truth.

Legacy note:

- Older rules may have required Captain to be one of the manager's draft picks. This should not be hard-coded. If desired in future, it can be added as a configurable rule.

### 7.10 Supersub rule

- Each submitted squad must have exactly one Supersub.
- Supersub is outside the 15 starters.
- Supersub can be any player not drafted by another manager, subject to budget and other rules.
- If the Supersub comes off the real-life bench, apply a high multiplier.
- If the Supersub starts in real life, apply a reduced multiplier.
- If the Supersub does not play, score 0.

Configurable default:

```json
{
  "supersub_bench_multiplier": 3,
  "supersub_starter_multiplier": 0.5,
  "supersub_not_played_points": 0,
  "admin_override_allowed": true
}
```

Important unresolved detail:

- Earlier discussion mentioned one-third points if a Supersub starts, while the legacy spreadsheet indicates half points. The architecture must keep this configurable. The live-season default should be confirmed against the official 2027 rules or league decision before launch.

### 7.11 Head-to-head rules

SPAL supports both:

1. Total-points table.
2. Head-to-head table.

Normal H2H fixture:

```text
Win: 4 H2H league points
Draw: 2 H2H league points
Loss: 0 H2H league points
```

Triple fixture:

```text
1st / highest score: 4 H2H league points
2nd: 2 H2H league points
3rd / lowest score: 0 H2H league points
```

### 7.12 Odd-number league fixture rule

For odd-number leagues, use one rotating triple fixture per gameweek.

Because the Six Nations has 5 gameweeks, there are 5 triple fixtures and 15 triple places. The fixture generator should:

- Create one triple fixture per gameweek.
- Ensure every manager appears in at least one triple fixture where mathematically possible.
- Balance triple participation as evenly as possible.
- Avoid repeat triple combinations where possible.
- Avoid repeat pairings where possible.
- Allow admin override.

### 7.13 Triple fixture tie handling

Recommended tie handling:

- Two managers tie for first: both receive 3 points, third receives 0.
- Two managers tie for second: first receives 4, tied managers receive 1 each.
- All three tie: all receive 2.

This should be configurable if the league wants a different approach.

---

## 8. Application modules

### 8.1 Public / entry module

Routes:

```text
/spal/
/spal/laws
/spal/history
```

Purpose:

- Explain SPAL.
- Provide access to guest views.
- Provide sign-in entry point.
- Display appropriate public or guest-safe content.

### 8.2 Auth module

Purpose:

- Manager login.
- Invite acceptance.
- Profile creation.
- Team name management.

### 8.3 League module

Purpose:

- League dashboard.
- Current season summary.
- Manager list.
- Draft ownership summary.
- Squad submission status.
- Latest scores and standings.

### 8.4 Draft module

Purpose:

- Draft setup.
- Draft order.
- Live draft room.
- Draft board.
- Available player pool.
- Pick validation.
- Admin controls.
- Realtime updates.

### 8.5 Squad module

Purpose:

- Full round squad builder.
- Budget bar.
- Position validation.
- Nation validation.
- Italian starter validation.
- Draft ownership validation.
- Captain and Supersub selection.
- Submission and lock status.

### 8.6 Fixtures module

Purpose:

- Real Six Nations fixtures.
- SPAL H2H fixtures.
- Triple fixture display.
- Matchday squad display.
- Team sheets with drafted-player highlighting.

### 8.7 Scoring module

Purpose:

- Player match score import.
- Apply admin overrides.
- Calculate manager match scores.
- Calculate manager round scores.
- Calculate H2H fixture results.
- Calculate total-points table.
- Recalculate on data changes.

### 8.8 Stats module

Purpose:

- Player performance analytics.
- Manager analytics.
- Draft value analysis.
- Squad value analysis.
- Position/nation analysis.
- Captain/Supersub performance.

### 8.9 History module

Purpose:

- Season archives.
- All-time table.
- Historic champions.
- Historic draft records.
- Past standings.
- Legacy imports.

### 8.10 Chronicle module

Purpose:

- Weekly previews.
- Weekly result write-ups.
- Draft recaps.
- Penalty notices.
- Season reviews.
- League culture and banter.

This replaces the old static/blog-style Wix workflow with structured app content.

### 8.11 Imports module

Purpose:

- Data source configuration.
- Import runs.
- Raw payload storage.
- Normalisation.
- Data quality review.
- Manual CSV upload.
- Legacy spreadsheet staging.

### 8.12 Admin module

Purpose:

- Season setup.
- League setup.
- Rule configuration.
- Import review.
- Overrides.
- Penalties.
- Round finalisation.
- Guest link management.
- Audit log review.

### 8.13 Notifications module

Purpose:

- In-app notifications.
- Email invites.
- Draft reminders.
- Async draft on-the-clock emails.
- Squad deadline reminders.
- Results summaries.
- Browser push later if appropriate.

---

## 9. Data-source architecture

### 9.1 Principle

External systems provide data; SPAL owns the game.

No app module should depend directly on an external API schema. External data must flow through adapters, raw storage, normalisation, validation, and optional admin review.

### 9.2 Data source types

Supported or planned:

- Official fantasy feed/API.
- Official Six Nations site or app data where accessible.
- Legacy 2026 spreadsheet.
- Manual admin input.
- CSV uploads.
- Future licensed or third-party rugby API.

### 9.3 Source trust levels

#### Level 1: Authoritative structured data

Examples:

- Official fantasy feed player IDs.
- Official fantasy points.
- Official price data.

Treatment:

- Import into canonical tables after validation.
- Preserve raw payload.
- Allow admin override.

#### Level 2: Legacy structured data

Examples:

- 2026 spreadsheet.
- Manually prepared historic CSVs.

Treatment:

- Import into staging.
- Flag ambiguities.
- Require admin review before canonical promotion.

#### Level 3: Reference-only legacy data

Examples:

- Old Wix pages.
- Screenshots.
- Blog content.

Treatment:

- Use for context and visual/history inspiration.
- Do not automatically treat as canonical.

### 9.4 Adapter interface concept

Pseudocode:

```ts
interface RugbyDataAdapter {
  sourceName: string;

  fetchPlayers(season: Season): Promise<RawImportResult>;
  fetchFixtures(season: Season): Promise<RawImportResult>;
  fetchPrices(season: Season, round?: number): Promise<RawImportResult>;
  fetchMatchdaySquads(round: number): Promise<RawImportResult>;
  fetchPlayerScores(matchId: string): Promise<RawImportResult>;

  normalisePlayers(raw: RawImportResult): Promise<CanonicalPlayer[]>;
  normaliseFixtures(raw: RawImportResult): Promise<CanonicalFixture[]>;
  normalisePrices(raw: RawImportResult): Promise<CanonicalPrice[]>;
  normaliseSquads(raw: RawImportResult): Promise<CanonicalMatchdaySquadStatus[]>;
  normaliseScores(raw: RawImportResult): Promise<CanonicalPlayerScore[]>;
}
```

Initial adapters:

```text
officialFantasyAdapter
legacySpreadsheetAdapter
csvUploadAdapter
manualAdminAdapter
```

Future adapters:

```text
licensedDataProviderAdapter
publicStatsAdapter
```

---

## 10. Import, sanitisation, and transformation

### 10.1 Import pipeline

```text
1. Fetch or upload source data.
2. Store raw payload unchanged.
3. Record import run metadata.
4. Validate source structure.
5. Normalise fields.
6. Match to existing canonical records.
7. Flag uncertain matches.
8. Apply transformations.
9. Apply admin overrides.
10. Promote clean data to canonical tables.
11. Recalculate affected scores where needed.
12. Audit changes.
```

### 10.2 Required transformations

#### Names

- Trim whitespace.
- Preserve display names.
- Generate normalised search names.
- Handle accents and diacritics.
- Handle initials and abbreviations.
- Detect duplicate names.
- Avoid matching players by name alone when source IDs are available.

#### Nations

Map variants to canonical names.

Examples:

```text
ENG, England, ENGLAND -> England
IRE, Ireland -> Ireland
ITA, Italy -> Italy
```

#### Positions

Map source labels to canonical SPAL positions and groups.

Examples:

```text
P -> Prop -> Front Row
H -> Hooker -> Front Row
FL -> Back Row -> Back Row
N8 -> Back Row -> Back Row
FB -> Full-back -> Outside Back
W -> Wing -> Outside Back
C -> Centre -> Centre
FH -> Fly-half -> Fly-half
SH -> Scrum-half -> Scrum-half
R -> Replacement status, not a position
```

#### Prices

- Convert to numeric.
- Ensure non-negative.
- Store source price.
- Store override price.
- Store final price.
- Support round-specific snapshots.

#### Scores

- Convert to numeric.
- Preserve decimals.
- Track provisional/final/corrected status.
- Store official/imported score separately from override/final score.

#### Dates and times

- Store UTC in database.
- Display in Europe/London time.
- Keep match lock deadlines explicit.

#### Shirt numbers and matchday status

For team-sheet imports:

```text
1-15 -> starting
16-23 -> bench/replacement
missing -> unknown/not selected depending on source context
```

### 10.3 Data quality issue codes

Initial set:

```text
PLAYER_NAME_AMBIGUOUS
PLAYER_NOT_FOUND
PLAYER_DUPLICATE
POSITION_UNKNOWN
NATION_UNKNOWN
PRICE_MISSING
PRICE_INVALID
SCORE_MISSING
SCORE_INVALID
MATCH_NOT_FOUND
SQUAD_STATUS_UNKNOWN
DRAFT_SLOT_INVALID
OWNERSHIP_CONFLICT
IMPORT_SCHEMA_CHANGED
```

### 10.4 Import health dashboard

Admin should see:

- Last import run by type.
- Records created/updated/flagged.
- Error count.
- Warnings needing review.
- Unmatched players.
- Changed prices.
- Changed scores after previous finalisation.
- Schema-change warnings.

---

## 11. Legacy spreadsheet context

The uploaded 2026 workbook is useful context but not authoritative. It contains rules, draft picks, historic standings, weekly squads, stats, and website-style views.

Observed sheet types include:

- 2026 weekly squads and matchday data.
- 2026 stats/scoring data.
- 2026 rules/scoring summary.
- Laws and approach.
- Yearly standings and historic stats.
- Previous year draft rounds.
- Website/prototype presentation views.

SPAL should include a `legacySpreadsheetAdapter` that can stage this data for admin review.

### 11.1 Legacy import staging tables

Recommended:

```sql
legacy_import_files
legacy_import_sheets
legacy_import_rows
legacy_import_issues
```

### 11.2 Treatment

Use the spreadsheet for:

- 2026 historical/test seed data.
- Historical standings context.
- Draft history context.
- Legacy stat ideas.
- Product workflow inspiration.

Do not use it as:

- Authoritative player database.
- Final official scoring source.
- Final 2027 rule source.
- Only historical source.

---

## 12. Legacy Wix context

The old Wix site is useful product inspiration but not authoritative. It demonstrates the league's existing public-facing structure:

- Home.
- Blog-style updates.
- The Laws.
- Historic performance.
- Year-by-year pages.
- Draft picks.
- Weekly squads.
- Standings.
- Draft-by-position and draft-by-round views.

SPAL should preserve this spirit through structured modules:

- The Laws.
- Chronicle.
- History.
- Draft archive.
- Weekly squad/team-sheet views.
- Historic performance/all-time table.

SPAL should not depend on Wix for future operation.

---

## 13. Data model overview

This is a high-level schema outline. Detailed SQL migrations should be developed separately.

### 13.1 Identity

```sql
profiles
user_roles
```

Key fields:

```text
profile id
email
name/display_name
team_name
avatar_url
created_at
```

### 13.2 Seasons and leagues

```sql
seasons
season_rules
leagues
league_members
league_guest_links
```

Key concepts:

- Season year.
- Ruleset JSON.
- League status.
- Commissioner/admin.
- Member role.
- Previous-year rank.
- Draft position.
- Guest share token hash.

### 13.3 Data sources and imports

```sql
data_sources
import_runs
raw_import_payloads
source_entity_mappings
data_quality_issues
```

### 13.4 Players and prices

```sql
players
player_positions
position_mappings
player_prices
player_price_snapshots
```

Player fields:

```text
season_id
external/source ids
display_name
search_name
nation
official_position
canonical_position
position_group
active
raw_profile
```

Price fields:

```text
official_price
override_price
final_price
round_number
source
imported_at
```

### 13.5 Fixtures and match data

```sql
matches
matchday_squads
player_match_scores
player_match_stat_breakdowns
```

### 13.6 Draft

```sql
drafts
draft_slots
draft_picks
player_ownership view
```

### 13.7 Squads

```sql
manager_round_squads
manager_round_squad_players
squad_validation_results
```

### 13.8 Scoring and standings

```sql
manager_match_scores
manager_round_scores
fixture_groups
fixture_group_members
league_standings
manager_season_records
all_time_manager_records view
```

### 13.9 Chronicle, history, penalties

```sql
league_posts
league_penalties
historic_records
legacy_references
```

### 13.10 Admin and audit

```sql
admin_overrides
audit_log
```

### 13.11 Notifications

```sql
notifications
email_events
browser_push_subscriptions
```

---

## 14. Admin overrides and audit

Admin overrides are essential. SPAL should keep the league running even when imported data is incomplete or wrong.

Admin must be able to override:

- Player name/display details.
- Player nation.
- Player position.
- Player price.
- Matchday status.
- Gameweek 1 starter status.
- Player score.
- Rule values.
- Squad lock status.
- H2H fixture generation.
- Penalties.

Every override should be audited.

Recommended table:

```sql
admin_overrides
- id uuid primary key
- league_id uuid nullable
- season_id uuid
- entity_type text
- entity_id uuid
- field_name text
- old_value jsonb
- new_value jsonb
- reason text
- created_by uuid
- created_at timestamptz
```

---

## 15. Validation engine

Validation should run server-side for all critical actions. Client validation may improve UX but must never be the only validation.

### 15.1 Draft pick validation

Check:

- Draft exists and is live.
- Manager is on the clock.
- Player exists and is active.
- Player is not already drafted.
- Pick satisfies chosen draft slot eligibility.
- Manager has not already filled that draft slot.
- Max drafted players per nation is not exceeded.
- Timer/admin status allows the pick.

### 15.2 Squad validation

Check:

- Squad belongs to logged-in manager.
- Round is open.
- Submission before lock unless admin override.
- Exactly 15 starters.
- Exactly 1 Supersub.
- Exactly 1 Captain.
- No duplicate players.
- Captain is one of the 15 starters.
- Supersub is not one of the 15 starters.
- Required positions are satisfied.
- Budget is within limit.
- Max players per nation is satisfied.
- Italian starter rule is satisfied if enabled.
- No selected player is drafted by another manager.

Validation response should be structured:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "BUDGET_EXCEEDED",
      "message": "Squad is 204 stars against a 200-star limit."
    }
  ],
  "warnings": [
    {
      "code": "PLAYER_NOT_IN_MATCHDAY_23",
      "message": "Selected player is not currently listed in the matchday squad."
    }
  ]
}
```

### 15.3 Scoring validation

Check:

- Player scores exist for selected players where expected.
- Supersub real-life status is known.
- Captain and Supersub multipliers are applied once.
- Admin overrides are applied.
- Penalties are applied.
- Round has no unresolved blocking data issues before finalisation.

---

## 16. Scoring engine

### 16.1 Player score model

For each player match score:

```text
source_points
admin_override_points
final_points = admin_override_points ?? source_points
status = provisional | final | corrected
```

### 16.2 Manager score model

For each selected player:

```text
regular starter: final_points
captain: final_points * captain_multiplier
supersub from real-life bench: final_points * supersub_bench_multiplier
supersub starts: final_points * supersub_starter_multiplier
supersub does not play: supersub_not_played_points
```

### 16.3 Score recalculation

A scoring recalculation should happen when:

- Player score import changes.
- Admin overrides a score.
- Matchday status changes.
- Admin changes a rule.
- Penalty is added/changed.
- Squad is corrected by admin.

Scoring should be deterministic and testable.

### 16.4 Decimal handling

Scores should preserve decimals internally.

Display rules should be configurable, for example:

```text
show 1 decimal place
or
show whole number if no decimal
```

Do not round internally unless rules require it.

---

## 17. H2H fixture model

Use fixture groups rather than hard-coded home/away pairings.

```sql
fixture_groups
- id
- league_id
- round_number
- fixture_type -- pair, triple
- status

fixture_group_members
- id
- fixture_group_id
- league_member_id
- score
- placing
- h2h_points
```

This supports:

```text
A v B
C v D v E
```

and future extensions.

---

## 18. Stats, analytics, and history

### 18.1 Current season dashboard

Show:

- H2H table.
- Total-points table.
- Current round fixtures.
- Squad submission status.
- Highest score this round.
- Biggest win.
- Closest fixture.
- Drafted-player watchlist.
- Latest Chronicle post.

### 18.2 Manager analytics

Show:

- Weekly scores.
- Cumulative score.
- H2H record.
- Total fantasy points.
- Drafted-player points.
- Undrafted-player points.
- Best Captain.
- Best Supersub.
- Squad value.
- Missed points or notable bench outcomes.

### 18.3 Player analytics

Show:

- Total points.
- Points per match.
- Price.
- Points per budget star.
- Nation.
- Position.
- Draft owner.
- Selection count.
- Captain count.
- Supersub count.
- Match-by-match scoring.

### 18.4 Draft analytics

Show:

- Draft board by manager.
- Draft board by position.
- Draft board by round.
- Best drafted player.
- Worst drafted player.
- Draft value by manager.
- Points from drafted players.
- Points from undrafted players.
- Draft pick return on investment.

### 18.5 Historical views

Support:

- Season archive.
- Final standings.
- Weekly standings.
- Champions.
- Wooden spoons if desired.
- Most-drafted players.
- Winning drafts.
- H2H history between managers.
- All-time table.
- Record book.

### 18.6 All-time table

Suggested metrics:

- Seasons played.
- Championships.
- Runner-up finishes.
- Average finishing position.
- H2H points.
- H2H wins/draws/losses.
- Total fantasy points.
- Average round score.
- Highest single-round score.
- Round wins.
- Best Captain pick.
- Best Supersub pick.

---

## 19. Chronicle and league culture

SPAL should preserve the league's personality.

### 19.1 Chronicle content types

```text
Weekly preview
Weekly results
Draft recap
Penalty notice
Admin note
Season review
Historic article
Data correction note
```

### 19.2 Chronicle table

```sql
league_posts
- id uuid primary key
- league_id uuid
- season_id uuid
- round_number int nullable
- post_type text
- title text
- slug text
- body_md text
- visibility text -- manager, guest, public
- author_id uuid
- published_at timestamptz
- created_at timestamptz
- updated_at timestamptz
```

### 19.3 Tone

The tone can be lightly absurd, affectionate, and league-specific. It should preserve the Sergio mythology and old league culture without making the UI confusing.

---

## 20. Penalties

SPAL should block most invalid submissions before they happen, but penalties are useful for legacy continuity and admin flexibility.

Examples:

- Late squad submission.
- Ineligible player selected after lock.
- Draft ownership breach discovered after submission.
- Admin-applied rule breach penalty.
- Light-hearted/joke penalty if the league wants to preserve that tradition.

Recommended table:

```sql
league_penalties
- id uuid primary key
- league_id uuid
- season_id uuid
- round_number int
- league_member_id uuid
- penalty_type text
- description text
- points_adjustment numeric nullable
- squad_rule_adjustment jsonb nullable
- created_by uuid
- created_at timestamptz
```

---

## 21. Visual system

### 21.1 Principle

SPAL should feel like:

```text
personal website
+ private rugby club noticeboard
+ fantasy sports dashboard
+ annual league archive
```

It should not feel like a generic corporate SaaS app.

### 21.2 Relationship to existing CSS

Before implementation, inspect the existing `nosky.co.uk` CSS and identify:

- Colour tokens.
- Typography.
- Spacing.
- Link styles.
- Card/table conventions.
- Layout shell.

SPAL should reuse existing site conventions where appropriate and define its own additional tokens for rugby/stat-heavy views.

### 21.3 Possible SPAL theme layer

Suggested direction:

```text
Dark navy / charcoal base
Warm off-white panels
Gold accent
Subtle Italian green/red highlights
Readable tables
Bold score numbers
Compact badges for positions and nations
```

### 21.4 Component priorities

Reusable components:

```text
LeagueTable
FixtureCard
TripleFixtureCard
DraftBoard
DraftPickCard
PlayerBadge
ManagerBadge
NationBadge
PositionBadge
BudgetBar
ValidationPanel
SquadBuilder
ImportIssueRow
ScoreBreakdown
HistoryRecordCard
ChroniclePostCard
```

### 21.5 Accessibility

- Desktop-first but mobile-compatible.
- Tables must remain readable on smaller screens.
- Colour should not be the only way to convey state.
- Use semantic headings and landmark regions.
- Keyboard navigation should work for draft and squad selection flows where practical.

---

## 22. Security and privacy

### 22.1 Principles

- Use Supabase Row Level Security on exposed tables.
- Never expose official feed/API tokens to the browser.
- Use Edge Functions for critical writes and server-side validation.
- Keep service role key server-side only.
- Store minimum personal data.
- Audit admin actions.
- Hash private guest tokens.

### 22.2 Sensitive data

Sensitive:

- User emails.
- Auth IDs.
- Invite tokens.
- Guest tokens.
- External API credentials.
- Raw import payloads if they contain private or licensed data.
- Admin notes.

Guest-visible data must exclude sensitive fields.

### 22.3 Critical server-side operations

Must be performed through Edge Functions or trusted server-side code:

- Draft pick validation and creation.
- Squad submission.
- Import execution.
- Scoring recalculation.
- Round finalisation.
- Admin overrides.
- Email sending.
- Guest token creation.

### 22.4 Guest links

Guest links should use opaque random tokens. Store only hashed token values.

Guest links should be revocable.

Optional:

- Expiry date.
- View count.
- Last accessed timestamp.

---

## 23. Notifications

### 23.1 In-app notifications

Use for:

- Draft started.
- Pick made.
- Squad deadline approaching.
- Squad submitted.
- Round scores finalised.
- Head-to-head result available.
- Admin data correction.

### 23.2 Email notifications

Use for:

- League invite.
- Draft scheduled.
- Draft reminder.
- Async draft: manager is on the clock.
- Squad deadline reminder.
- Round result summary.

Do not send on-the-clock emails during live drafts unless later requested.

### 23.3 Browser notifications

Later enhancement:

- On-the-clock alert.
- Draft resumed.
- Squad deadline soon.
- Round result finalised.

---

## 24. Workflows and user journeys

### 24.1 Admin: season setup

```text
1. Create season.
2. Configure rules.
3. Import player list.
4. Import prices.
5. Import fixtures.
6. Review data issues.
7. Set weakest nation.
8. Configure Italian starter rule.
9. Create league.
10. Invite managers.
11. Enter previous-year standings.
12. Generate draft order.
13. Schedule draft.
```

### 24.2 Manager: onboarding

```text
1. Receive invite.
2. Sign in.
3. Set display name and team name.
4. Read The Laws.
5. View draft order.
6. Build draft watchlist if implemented.
```

### 24.3 Live draft

```text
1. Admin starts draft.
2. Current manager goes on clock.
3. Manager filters available players.
4. Manager selects player.
5. Manager assigns eligible draft slot.
6. Server validates pick.
7. Pick is saved.
8. Realtime updates draft board.
9. Next manager goes on clock.
10. Admin can pause/resume/undo/manual pick.
```

### 24.4 Round squad submission

```text
1. Manager opens My Squad.
2. Selects 15 starters.
3. Selects 1 Supersub.
4. Selects Captain.
5. Sees budget usage.
6. Sees position/nation/rule validation.
7. Fixes errors.
8. Submits full squad.
9. Squad locks at deadline.
```

### 24.5 Scoring and finalisation

```text
1. Scores are imported after matches.
2. Matchday statuses are imported or confirmed.
3. App calculates provisional scores.
4. Admin reviews unresolved issues.
5. Admin applies overrides if needed.
6. App recalculates affected scores.
7. Admin finalises round.
8. Standings update.
9. Chronicle/results summary can be published.
10. Notifications are sent.
```

### 24.6 Guest journey

```text
1. Guest opens private link.
2. Guest views dashboard.
3. Guest explores standings, fixtures, draft board, stats, history, and The Laws.
4. Guest cannot edit anything.
```

---

## 25. Documentation and Claude Code workflow

### 25.1 Documentation principle

The code, rules, and docs should move together.

Any change to game rules, schema, imports, scoring, security, deployment, visual tokens, or module boundaries should update the relevant documentation in the same change.

### 25.2 Keep CLAUDE.md lightweight

Use `CLAUDE.md` as a concise guide, not the full product spec.

It should include:

- Project summary.
- Core stack.
- Non-negotiable architecture decisions.
- Pointers to detailed docs.
- Verification commands.
- Documentation update rules.

It should not include the full SPAL domain spec.

### 25.3 Recommended docs structure

```text
CLAUDE.md

docs/product/spal-spec.md
docs/product/rules.md
docs/product/user-journeys.md
docs/product/league-culture.md
docs/product/legacy-sources.md

docs/architecture/spal-architecture.md
docs/architecture/data-model.md
docs/architecture/import-pipeline.md
docs/architecture/scoring-engine.md
docs/architecture/security.md
docs/architecture/visual-system.md
docs/architecture/modularity.md

docs/admin/season-setup.md
docs/admin/import-review.md
docs/admin/admin-overrides.md
docs/admin/finalising-rounds.md

docs/development/local-setup.md
docs/development/environment-variables.md
docs/development/testing.md
docs/development/deployment.md
docs/development/claude-code-workflow.md

docs/adr/0001-use-supabase.md
docs/adr/0002-host-spal-under-nosky.md
docs/adr/0003-use-modular-data-adapters.md
docs/adr/0004-store-raw-and-normalised-imports.md
docs/adr/0005-use-configurable-rules-engine.md
docs/adr/0006-use-fixture-groups-for-pair-and-triple-h2h.md
```

### 25.4 Suggested CLAUDE.md content

```md
# nosky.co.uk / SPAL Claude Guide

## Project
This repo contains nosky.co.uk and the Sergio Parisse Appreciation League app at /spal.

## Core stack
- Vite / React / TypeScript
- Supabase Auth, Postgres, Realtime, Edge Functions
- Netlify

## Non-negotiables
- SPAL owns league state; external feeds are data sources only.
- Do not expose official feed tokens in the browser.
- Use Edge Functions for draft picks, squad submission, imports and scoring.
- Enable and maintain RLS for exposed Supabase tables.
- Store raw imports and normalised canonical data.
- Admin overrides must be audited.
- Update docs when changing rules, schema, imports, scoring, security or visual tokens.

## Key docs
- Product spec: docs/product/spal-spec.md
- Architecture: docs/architecture/spal-architecture.md
- Data model: docs/architecture/data-model.md
- Imports: docs/architecture/import-pipeline.md
- Scoring: docs/architecture/scoring-engine.md
- Security: docs/architecture/security.md
- Visual system: docs/architecture/visual-system.md

## Verification
- npm run typecheck
- npm run lint
- npm run test
- npm run build
```

---

## 26. Testing strategy

### 26.1 Unit tests

Test:

- Draft pick validation.
- Squad validation.
- Budget calculation.
- Position requirements.
- Nation limits.
- Italian starter rule.
- Captain scoring.
- Supersub scoring.
- H2H scoring.
- Triple scoring.
- Fixture generation.
- Import transformations.

### 26.2 Integration tests

Test:

- Manager can submit valid squad.
- Manager cannot select another manager's drafted player.
- Admin override changes final scoring.
- Draft pick creates ownership.
- Guest can only read guest-safe views.
- RLS prevents cross-user edits.

### 26.3 Import regression tests

Use saved raw import fixtures:

```text
fixtures/imports/2026/players.json
fixtures/imports/2026/prices.json
fixtures/imports/2026/matches.json
fixtures/imports/2026/scores.json
fixtures/imports/legacy-spreadsheet/sample-rows.json
```

### 26.4 Scoring regression tests

For each scoring rule change, keep examples:

- Regular player.
- Captain.
- Supersub from bench.
- Supersub starts.
- Supersub does not play.
- Negative points.
- Admin override.
- Penalty applied.

---

## 27. MVP phases

### Phase 0: Documentation and project setup

Deliver:

- `CLAUDE.md`.
- Product spec.
- Architecture docs.
- Initial ADRs.
- Existing `nosky.co.uk` CSS/project inspection.
- Decision on `/spal` integration approach.

### Phase 1: Historical 2026 prototype

Purpose: prove game logic using completed data.

Deliver:

- Supabase schema foundation.
- Auth.
- Admin-created 2026 season.
- Player pool.
- Price data.
- Score data.
- Draft ownership.
- Full squad builder.
- Budget validation.
- Captain/Supersub scoring.
- Total-points table.
- Basic H2H and triple scoring.
- Admin overrides.
- Basic rules page.

### Phase 2: Core league experience

Deliver:

- Live draft room.
- Realtime draft updates.
- Timer.
- Draft admin controls.
- Fixture generator.
- Guest share link.
- Player stats.
- Manager stats.
- History section.
- Chronicle posts.

### Phase 3: 2027 live readiness

Deliver:

- Modular data source adapters.
- Import health dashboard.
- Matchday squad import.
- Price snapshots.
- Round lock workflow.
- Round finalisation workflow.
- Email notifications.
- Scoring issue review.
- All-time table.

### Phase 4: Polish and resilience

Deliver:

- Browser notifications.
- Async draft mode.
- Draft queues/autopick.
- Advanced stats dashboards.
- Data exports.
- Better mobile UI.
- Legacy archive completion.

---

## 28. Initial implementation plan for Claude Code

### Step 1: Create docs only

First Claude Code task should create documentation structure and not app code.

Prompt:

```text
Read CLAUDE.md if present.
Create initial SPAL documentation structure.
Do not implement app code yet.
Create or update:
- CLAUDE.md
- docs/product/spal-spec.md
- docs/product/rules.md
- docs/product/user-journeys.md
- docs/product/league-culture.md
- docs/product/legacy-sources.md
- docs/architecture/spal-architecture.md
- docs/architecture/data-model.md
- docs/architecture/import-pipeline.md
- docs/architecture/scoring-engine.md
- docs/architecture/security.md
- docs/architecture/visual-system.md
- docs/development/claude-code-workflow.md
- docs/adr/0001-use-supabase.md
- docs/adr/0002-host-spal-under-nosky.md
- docs/adr/0003-use-modular-data-adapters.md
- docs/adr/0004-use-configurable-rules-engine.md
Keep CLAUDE.md lightweight and point to detailed docs.
```

### Step 2: Inspect current site

Prompt:

```text
Inspect the existing nosky.co.uk project structure and CSS.
Propose how to integrate /spal without disrupting the existing site.
Extract reusable visual tokens and identify what SPAL-specific styles are needed.
Do not implement app code yet.
```

### Step 3: Scaffold app

Prompt:

```text
Read CLAUDE.md and docs/product/spal-spec.md.
Scaffold the /spal app using Vite, React, TypeScript, Tailwind, and Supabase.
Create routing, layout, placeholder pages, and environment variable handling.
Do not implement business logic yet.
```

### Step 4: Database and rules engine

Prompt:

```text
Implement initial Supabase migrations for seasons, leagues, profiles, players, prices, drafts, squads, fixture groups, scores, imports, overrides, and audit logs.
Add RLS policies.
Add TypeScript types.
Add tests for the rules engine.
```

---

## 29. Open questions to confirm

These are the remaining questions that would improve the build spec before implementation. None block v0.1, but they should be resolved before live 2027 use.

### 29.1 Scoring and rules

1. Should the Supersub starter multiplier default to **0.5** based on the legacy spreadsheet, or should it remain unset until the 2027 official rules are confirmed?
2. Should the Italian starter rule have any position exclusions, or is any Italian starting XV player acceptable?
3. Should the Italian starter rule be enforced strictly, or should admin be able to allow submission with a warning and later penalty?
4. Should Captain be allowed to be any starter, or do you want an optional mode where Captain must be one of the manager's drafted players?
5. Should budget validation use the price at round lock, latest imported price, or manually finalised round price?

### 29.2 Draft

6. Should the optional Bench/Sub draft pick be mandatory in some seasons, or always optional?
7. If a player's Gameweek 1 starting status is unknown at draft time, should they be eligible for the Bench/Sub draft slot with warning, or blocked until confirmed?
8. Should async draft mode be built for MVP or only after the first live draft version works?

### 29.3 Squad and locks

9. Should squads lock at first match kickoff of the round, or should player-level locks be supported eventually?
10. Should managers be able to save drafts of squads before submitting?
11. Should late submissions be blocked, allowed with penalty, or admin-controlled?

### 29.4 Data and imports

12. Which data source should be treated as the preferred live 2027 scoring source if the official feed is available?
13. How much of the 2026 spreadsheet should be imported into canonical tables versus kept as legacy/reference data?
14. Do you want CSV upload templates for players, prices, squads, and scores in MVP?
15. Should raw import payloads be visible to admin in the UI, or only downloadable/exportable?

### 29.5 Website and visual design

16. Should SPAL reuse the existing `nosky.co.uk` navigation/header exactly, or have a distinct SPAL sub-navigation?
17. Do you want a dark-first SPAL visual style, or should it more closely follow the current nosky style after inspection?
18. Should any old Wix pages be recreated manually as Chronicle/history content, or only linked as legacy references?

### 29.6 Notifications

19. Which email provider should be used: Resend, Postmark, SendGrid, or another?
20. Should browser notifications be included before the first live 2027 season, or left as a later enhancement?

### 29.7 Privacy and guest access

21. Should guest links be season-specific or league-wide across all seasons?
22. Should guest pages be indexed by search engines, or should they include noindex headers/meta tags?
23. Should guest links expire automatically or remain valid until revoked?

---

## 30. Summary of non-negotiable architecture decisions

- SPAL is a standalone private fantasy game, not just an official-site companion.
- External sources are data feeds only; SPAL owns league state.
- All external data must pass through adapters and normalisation.
- Store raw imported data and canonical normalised data.
- Admin overrides are required and must be audited.
- Rules must be configurable by season where practical.
- Draft picks and squad submissions must be validated server-side.
- Supabase RLS must protect all exposed tables.
- Official/API tokens must never be exposed to the browser.
- Use fixture groups to support both pair and triple H2H fixtures.
- Preserve league history and culture through History and Chronicle modules.
- Keep `CLAUDE.md` lightweight and put detailed SPAL specs in dedicated docs.

---

## 31. Glossary

**SPAL**  
Sergio Parisse Appreciation League.

**Manager**  
A league participant who drafts players and submits squads.

**Admin / Commissioner**  
The user who manages setup, rules, imports, overrides, scoring finalisation, and guest links.

**Drafted player**  
A player selected during the SPAL draft. Drafted players are exclusive to their drafting manager.

**Undrafted player**  
A player not selected during the SPAL draft. Any manager may select undrafted players, subject to squad rules.

**Weakest nation slot**  
A draft slot requiring a player from the configured weakest nation, defaulting to Wales unless changed by season.

**Supersub**  
A special squad role. If the player comes off the real-life bench, they receive a multiplier; if they start, they receive a reduced multiplier; if they do not play, they score 0.

**Fixture group**  
A group of two or three managers competing in a head-to-head or triple fixture for a round.

**Canonical data**  
SPAL's cleaned, normalised, app-ready version of imported data.

**Raw payload**  
The original data received from an external source, stored for audit/debugging.

**Admin override**  
A manual correction that supersedes imported data or default rules.

**Chronicle**  
The SPAL module for weekly write-ups, results, penalties, recaps, and league storytelling.

