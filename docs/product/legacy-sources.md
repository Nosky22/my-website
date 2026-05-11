# Legacy Sources

---

## 1. The 2026 spreadsheet

A workbook covering the 2026 Six Nations season. It contains:

- Weekly squad selections for all 7 managers
- Matchday scoring data
- Draft picks by manager and slot
- Standings (final and weekly)
- Rules summary and scoring explanation
- Historical standings from previous years
- Draft records from previous years
- Website-style prototype views

### How to use it

The spreadsheet is **historical and test data only**. It is not authoritative.

Use it for:
- Seeding Phase 1 prototype with real 2026 season data
- Understanding how the league has worked in practice
- Identifying data shape and fields needed in the schema
- Historical standings context
- Draft history context

Do **not** treat it as:
- A canonical player database
- An authoritative scoring source
- A definitive 2027 rule source
- The only historical source (some history predates the spreadsheet)

### Import approach

The `legacySpreadsheetAdapter` will stage the spreadsheet data for admin review before any promotion to canonical tables. No automatic canonical promotion — admin reviews and approves each import.

Staging tables:
```
legacy_import_files
legacy_import_sheets
legacy_import_rows
legacy_import_issues
```

---

## 2. The old Wix site

A Wix-hosted site that served as the league's public presence before SPAL. It contains:

- Home page and league explanation
- Blog-style weekly updates (old Chronicle content)
- The Laws (rules page)
- Historical performance and year-by-year pages
- Draft picks (by manager, by round)
- Weekly squad views
- Standings

### How to use it

The Wix site is **reference and inspiration only**. It is not authoritative and should not be scraped or copied wholesale.

Use it for:
- Understanding the league's existing public-facing structure
- Identifying what Chronicle content types the league expects
- Understanding the historical depth wanted in the History module
- Tone and language reference

SPAL should not depend on the Wix site for future operation. Content from Wix that the league wants to preserve should be migrated manually into Chronicle posts or historic records.

---

## 3. Official fantasy feed / API

There is no reliable official Six Nations fantasy API with a stable, documented interface.

The official Guinness Fantasy Six Nations game provides player lists, prices, fixtures, matchday squads, and scoring — but through a web interface rather than a public API. Access methods may change between seasons.

### Implications

- SPAL cannot hard-code a dependency on any specific API endpoint or data format.
- The import pipeline must be modular: if the feed changes, the adapter can be updated without rewriting the rest of the app.
- Admin must be able to override any imported data.
- Admin must be able to operate SPAL entirely via CSV upload and manual input if the feed is unavailable.

### Adapter approach

Initial adapters:

| Adapter | Source |
|---------|--------|
| `officialFantasyAdapter` | Official fantasy feed where accessible |
| `legacySpreadsheetAdapter` | 2026 workbook |
| `csvUploadAdapter` | Admin-uploaded CSV files |
| `manualAdminAdapter` | Direct admin input in UI |

Future adapters (Phase 3+):

| Adapter | Source |
|---------|--------|
| `licensedDataProviderAdapter` | Licensed rugby stats provider if acquired |
| `publicStatsAdapter` | Public stats sources if available |

All adapters follow the same `RugbyDataAdapter` interface. See `docs/architecture/import-pipeline.md` for details.

---

## 4. Data trust levels

| Level | Examples | Treatment |
|-------|----------|-----------|
| 1 — Authoritative structured | Official feed player IDs, official points, prices | Import after validation, preserve raw payload, allow admin override |
| 2 — Legacy structured | 2026 spreadsheet, historic CSVs | Import to staging, flag ambiguities, require admin review before canonical promotion |
| 3 — Reference only | Old Wix pages, screenshots | Use for context and inspiration only; never treat as canonical |
