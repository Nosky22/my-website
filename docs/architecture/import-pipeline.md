# SPAL Import Pipeline

---

## Principle

External systems provide data. SPAL owns the game.

No app module reads directly from an external API. All external data flows through adapters, is stored as raw payloads, normalised, validated, reviewed by admin where needed, and only then promoted to canonical tables.

This means SPAL continues to function if a feed changes, partially fails, or must be replaced entirely by CSV or manual input.

---

## Pipeline stages

```
1.  Fetch or upload source data
2.  Store raw payload unchanged (raw_import_payloads)
3.  Record import run metadata (import_runs)
4.  Validate source structure (schema check)
5.  Normalise fields (names, nations, positions, prices, scores)
6.  Match to existing canonical records
7.  Flag uncertain matches (data_quality_issues)
8.  Apply admin overrides
9.  Promote clean data to canonical tables
10. Recalculate affected scores if scoring data changed
11. Audit all changes (audit_log)
```

Steps 1–7 run automatically. Steps 8–9 require admin review for flagged records. Step 10 is triggered automatically when score data changes.

---

## Adapter interface

All adapters implement the same interface:

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

Adapters run in Edge Functions, never in the browser.

---

## Adapters

### Initial adapters (Phase 1–2)

| Adapter | Source | Notes |
|---------|--------|-------|
| `officialFantasyAdapter` | Official Six Nations fantasy feed | Method may change; adapter must be updatable independently |
| `legacySpreadsheetAdapter` | 2026 workbook | Stages to legacy tables for admin review; not direct canonical promotion |
| `csvUploadAdapter` | Admin-uploaded CSV | Templated format; supports players, prices, scores, squads |
| `manualAdminAdapter` | Direct admin UI input | Bypasses import pipeline; writes directly with full audit |

### Future adapters (Phase 3+)

| Adapter | Source |
|---------|--------|
| `licensedDataProviderAdapter` | Licensed rugby stats API if acquired |
| `publicStatsAdapter` | Public stats sources if available |

---

## Normalisation rules

### Player names
- Trim whitespace
- Preserve display name as provided
- Generate `search_name`: lowercased, diacritics stripped, for matching
- Detect and flag duplicates before creating new canonical records
- Never match players by name alone when source IDs are available

### Nations
Map all source variants to canonical names:

| Source variants | Canonical |
|----------------|-----------|
| `ENG`, `England`, `ENGLAND` | `England` |
| `IRE`, `Ireland`, `IRELAND` | `Ireland` |
| `SCO`, `Scotland`, `SCOTLAND` | `Scotland` |
| `WAL`, `Wales`, `WALES` | `Wales` |
| `FRA`, `France`, `FRANCE` | `France` |
| `ITA`, `Italy`, `ITALY` | `Italy` |

Unknown nations → flag as `NATION_UNKNOWN`.

### Positions
Map source labels to canonical positions and position groups:

| Source labels | Canonical position | Position group |
|--------------|-------------------|----------------|
| `P`, `Prop`, `THP`, `LP` | `Prop` | `Front Row` |
| `H`, `Hooker` | `Hooker` | `Front Row` |
| `SR`, `Lock`, `Second Row` | `Second Row` | `Second Row` |
| `FL`, `Flanker` | `Flanker` | `Back Row` |
| `N8`, `Number 8` | `Number 8` | `Back Row` |
| `SH`, `Scrum-half` | `Scrum-half` | `Scrum-half` |
| `FH`, `Fly-half` | `Fly-half` | `Fly-half` |
| `C`, `Centre` | `Centre` | `Centre` |
| `W`, `Wing` | `Wing` | `Outside Back` |
| `FB`, `Full-back` | `Full-back` | `Outside Back` |
| `R`, `Replacement` | (not a position — denotes bench status) | — |

Unknown positions → flag as `POSITION_UNKNOWN`.

### Prices
- Convert to numeric
- Ensure non-negative
- Store `source_price` and `override_price` separately
- `final_price` = `override_price ?? source_price`
- Support round-specific snapshots (prices may change between rounds)

### Scores
- Convert to numeric; preserve decimals
- Store `source_points` and `admin_override_points` separately
- `final_points` = `admin_override_points ?? source_points`
- Track status: `provisional` → `final` → `corrected`

### Dates and times
- Store UTC in database
- Display in Europe/London time in UI
- Match lock deadlines stored explicitly as `timestamptz`

### Shirt numbers and matchday status
| Shirt number | Status |
|-------------|--------|
| 1–15 | `starting` |
| 16–23 | `bench` |
| Missing | `unknown` or `not_selected` depending on source context |

---

## Data quality issue codes

| Code | Meaning |
|------|---------|
| `PLAYER_NAME_AMBIGUOUS` | Name matches multiple canonical players |
| `PLAYER_NOT_FOUND` | No match found for source player |
| `PLAYER_DUPLICATE` | Apparent duplicate of existing record |
| `POSITION_UNKNOWN` | Position label not in known mapping |
| `NATION_UNKNOWN` | Nation not in known mapping |
| `PRICE_MISSING` | Expected price not found in source |
| `PRICE_INVALID` | Price value is negative or non-numeric |
| `SCORE_MISSING` | Expected score not found for player/match |
| `SCORE_INVALID` | Score value is non-numeric |
| `MATCH_NOT_FOUND` | Source references a match not in canonical fixtures |
| `SQUAD_STATUS_UNKNOWN` | Matchday status could not be determined |
| `DRAFT_SLOT_INVALID` | Draft pick does not satisfy slot requirements |
| `OWNERSHIP_CONFLICT` | Player already drafted by another manager |
| `IMPORT_SCHEMA_CHANGED` | Source data structure differs from expected adapter schema |

---

## Admin import health dashboard

Admin can see at a glance:

- Last import run by type (players, prices, fixtures, scores, matchday squads)
- Records created / updated / flagged per run
- Outstanding data quality issues requiring review
- Unmatched players
- Price changes since last run
- Score changes since previous finalisation
- Schema-change warnings

---

## Raw payload retention

All raw import payloads are stored unchanged in `raw_import_payloads`. They are:
- Never deleted automatically
- Accessible to admin for debugging
- Not exposed to managers or guests
- Linked to the `import_run` that produced them
