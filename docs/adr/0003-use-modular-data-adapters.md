# ADR 0003 — Use modular data adapters for all external data sources

**Status:** Accepted  
**Date:** 2026-05-10

---

## Context

SPAL needs external data: player lists, prices, fixtures, matchday squads, and player scores. These come from the official Six Nations fantasy game (or similar sources), which:

- Has no stable, publicly documented API
- May change its data format between seasons
- May become unavailable or restricted
- May be supplemented or replaced by a licensed data provider in the future

If SPAL modules read directly from an external API, any change to that API could break the entire application. An alternative is needed that decouples the external data format from the SPAL internal data model.

---

## Decision

All external data flows through a modular adapter layer:

```
External source
    ↓
Adapter (source-specific, interchangeable)
    ↓
Raw payload storage (unchanged)
    ↓
Normalisation (adapter-specific)
    ↓
Canonical SPAL tables (source-agnostic)
```

All adapters implement the same `RugbyDataAdapter` interface. The rest of SPAL only reads from canonical tables — it never reads directly from external sources.

Initial adapters: `officialFantasyAdapter`, `legacySpreadsheetAdapter`, `csvUploadAdapter`, `manualAdminAdapter`.

See `docs/architecture/import-pipeline.md` for the full interface specification and normalisation rules.

---

## Consequences

**Positive:**
- If the official feed changes format, only the `officialFantasyAdapter` needs updating — no other module is affected
- If the official feed is unavailable, admin can switch to CSV upload or manual input without changing SPAL's core
- Raw payloads are stored for audit and debugging, regardless of source
- New data providers (licensed stats APIs, etc.) can be added by implementing a new adapter without touching existing code
- Admin can override any imported data, so source imperfections do not block league operation

**Negative / constraints:**
- Import pipeline adds complexity compared to direct API reads
- Normalisation code must be maintained per adapter
- Admin must review and resolve data quality issues — the pipeline is not fully automatic
- Raw payload storage grows over time and will eventually need a retention policy

**Constraint this decision imposes:**
- No SPAL module may contain a direct HTTP call to an external data source
- All imports run server-side via Edge Functions (never from the browser)
- New data types (e.g. stat breakdowns) must be added to the `RugbyDataAdapter` interface and all relevant adapters
