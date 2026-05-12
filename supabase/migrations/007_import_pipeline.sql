-- ============================================================
-- SPAL Migration 007 — Import pipeline
-- data_sources, import_runs, raw_import_payloads,
-- data_quality_issues, legacy_import_files,
-- legacy_import_sheets, legacy_import_rows, legacy_import_issues
--
-- Prerequisites: 001_foundation.sql (seasons, profiles)
-- Note: All import tables are admin-only read — import internals
--   are tooling, not league data managers need to see.
-- Additive only — no existing tables altered or dropped
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── data_sources ──────────────────────────────────────────────
-- Registry of import adapters. One row per adapter type,
-- not per run. Adapters reference this table to identify
-- themselves when creating import_runs.

create table data_sources (
  id         bigint      generated always as identity primary key,
  name       text        not null unique,
  type       text        not null,
  config     jsonb,
  active     boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint data_sources_type_check
    check (type in ('api', 'csv', 'manual', 'legacy'))
);

comment on table  data_sources        is 'Registry of import adapters. One row per adapter type; referenced by import_runs to identify the data source.';
comment on column data_sources.name   is 'Machine identifier, e.g. officialFantasyAdapter, csvUploadAdapter, legacySpreadsheetAdapter.';
comment on column data_sources.type   is 'api | csv | manual | legacy.';
comment on column data_sources.config is 'Adapter-specific configuration (endpoint URLs, field mappings, etc.). Nullable for simple adapters.';

create trigger data_sources_updated_at
  before update on data_sources
  for each row execute function update_updated_at_column();


-- ── import_runs ───────────────────────────────────────────────
-- One row per import execution. Covers all adapter types and all
-- import categories. round_number is null for season-wide imports
-- (players, fixtures) and set for round-specific ones (prices,
-- matchday squads, scores).

create table import_runs (
  id              bigint      generated always as identity primary key,
  source_id       bigint      not null references data_sources(id),
  season_id       bigint      not null references seasons(id),
  import_type     text        not null,
  round_number    int,
  status          text        not null default 'pending',
  records_created int         not null default 0,
  records_updated int         not null default 0,
  records_flagged int         not null default 0,
  started_at      timestamptz,
  completed_at    timestamptz,
  run_by          uuid        references profiles(id),
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint import_runs_type_check
    check (import_type in ('players', 'fixtures', 'prices', 'matchday_squads', 'scores')),
  constraint import_runs_status_check
    check (status in ('pending', 'running', 'complete', 'failed')),
  constraint import_runs_round_positive
    check (round_number is null or round_number >= 1)
);

comment on table  import_runs                is 'One row per import execution across all adapter types. Drives the admin import health dashboard.';
comment on column import_runs.import_type    is 'players | fixtures | prices | matchday_squads | scores.';
comment on column import_runs.round_number   is 'Null for season-wide imports. Set for round-specific imports (prices, matchday squads, scores).';
comment on column import_runs.records_created is 'New canonical records written during this run.';
comment on column import_runs.records_updated is 'Existing canonical records updated during this run.';
comment on column import_runs.records_flagged is 'Records that produced data_quality_issues and need admin review.';
comment on column import_runs.run_by         is 'Null for automated scheduled runs; set when manually triggered by admin.';
comment on column import_runs.error_message  is 'Set on failed runs. Contains the top-level error; full detail is in raw_import_payloads.';

create trigger import_runs_updated_at
  before update on import_runs
  for each row execute function update_updated_at_column();

create index import_runs_source_id_idx       on import_runs (source_id);
create index import_runs_season_id_idx       on import_runs (season_id);
create index import_runs_season_type_idx     on import_runs (season_id, import_type);
create index import_runs_status_idx          on import_runs (status);
-- Supports "latest price import for round N" — common admin dashboard query
create index import_runs_season_round_idx    on import_runs (season_id, round_number)
  where round_number is not null;


-- ── raw_import_payloads ───────────────────────────────────────
-- Raw source data stored exactly as received. Never deleted
-- automatically. Linked to the import_run that produced them.
-- Insert-only: payloads are written once and read for debugging.

create table raw_import_payloads (
  id            bigint      generated always as identity primary key,
  import_run_id bigint      not null references import_runs(id),
  payload       jsonb       not null,
  created_at    timestamptz not null default now()
);

comment on table  raw_import_payloads            is 'Raw source data stored unchanged. Never deleted automatically. Linked to the import_run that produced them; used for debugging and re-processing.';
comment on column raw_import_payloads.payload    is 'Exact source data as received from the adapter, before any normalisation.';

create index raw_import_payloads_run_id_idx on raw_import_payloads (import_run_id);


-- ── data_quality_issues ───────────────────────────────────────
-- Flagged records from normalisation and validation that need
-- admin review before being promoted to canonical tables.
-- The scoring engine blocks round finalisation while any
-- unresolved issues remain for that round.
-- Has a lifecycle (pending → resolved) unlike the insert-only
-- audit tables; resolution is an UPDATE.

create table data_quality_issues (
  id            bigint      generated always as identity primary key,
  import_run_id bigint      not null references import_runs(id),
  issue_code    text        not null,
  description   text        not null,
  raw_data      jsonb,
  resolved      boolean     not null default false,
  resolved_by   uuid        references profiles(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table  data_quality_issues              is 'Flagged records from import normalisation/validation. Blocks round finalisation while unresolved. Admin reviews and resolves each issue.';
comment on column data_quality_issues.issue_code   is 'Machine identifier from the defined list, e.g. PLAYER_NAME_AMBIGUOUS, POSITION_UNKNOWN. See docs/architecture/import-pipeline.md.';
comment on column data_quality_issues.raw_data     is 'The offending source record that triggered the issue.';
comment on column data_quality_issues.resolved     is 'False until an admin marks the issue resolved.';

create trigger data_quality_issues_updated_at
  before update on data_quality_issues
  for each row execute function update_updated_at_column();

create index data_quality_issues_run_id_idx  on data_quality_issues (import_run_id);
create index data_quality_issues_code_idx    on data_quality_issues (issue_code);
-- Supports "all outstanding issues" — primary admin dashboard filter
create index data_quality_issues_open_idx    on data_quality_issues (import_run_id)
  where resolved = false;


-- ─────────────────────────────────────────────────────────────
-- LEGACY IMPORT STAGING TABLES
-- Used by legacySpreadsheetAdapter to stage the 2026 workbook
-- for admin review before any data is promoted to canonical tables.
-- Kept separate from main import tables to avoid polluting
-- canonical import history.
-- ─────────────────────────────────────────────────────────────


-- ── legacy_import_files ───────────────────────────────────────
-- One row per uploaded workbook file.

create table legacy_import_files (
  id                bigint      generated always as identity primary key,
  season_id         bigint      not null references seasons(id),
  original_filename text        not null,
  status            text        not null default 'pending',
  uploaded_by       uuid        not null references profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint legacy_import_files_status_check
    check (status in ('pending', 'processing', 'complete', 'failed'))
);

comment on table  legacy_import_files        is 'One row per uploaded 2026 workbook file. Parent of legacy_import_sheets.';
comment on column legacy_import_files.status is 'pending | processing | complete | failed.';

create trigger legacy_import_files_updated_at
  before update on legacy_import_files
  for each row execute function update_updated_at_column();

create index legacy_import_files_season_id_idx on legacy_import_files (season_id);


-- ── legacy_import_sheets ──────────────────────────────────────
-- One row per sheet within an uploaded workbook.

create table legacy_import_sheets (
  id         bigint      generated always as identity primary key,
  file_id    bigint      not null references legacy_import_files(id),
  sheet_name text        not null,
  row_count  int         not null default 0,
  status     text        not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint legacy_import_sheets_status_check
    check (status in ('pending', 'processing', 'complete', 'failed'))
);

comment on table  legacy_import_sheets        is 'One row per sheet in an uploaded workbook. Parent of legacy_import_rows.';
comment on column legacy_import_sheets.status is 'pending | processing | complete | failed.';

create trigger legacy_import_sheets_updated_at
  before update on legacy_import_sheets
  for each row execute function update_updated_at_column();

create index legacy_import_sheets_file_id_idx on legacy_import_sheets (file_id);


-- ── legacy_import_rows ────────────────────────────────────────
-- One row per source row staged from a sheet. Admin reviews
-- flagged rows before approving them for promotion to canonical
-- tables.

create table legacy_import_rows (
  id               bigint      generated always as identity primary key,
  sheet_id         bigint      not null references legacy_import_sheets(id),
  row_number       int         not null,
  raw_data         jsonb       not null,
  normalised_data  jsonb,
  status           text        not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint legacy_import_rows_status_check
    check (status in ('pending', 'flagged', 'approved', 'rejected', 'promoted'))
);

comment on table  legacy_import_rows                 is 'One row per source row staged for admin review. Status moves through pending → flagged/approved → promoted (or rejected).';
comment on column legacy_import_rows.raw_data        is 'Exact source cell values from the spreadsheet row, unchanged.';
comment on column legacy_import_rows.normalised_data is 'Normalised representation ready for promotion. Null until normalisation has run.';
comment on column legacy_import_rows.status          is 'pending | flagged (has issues) | approved | rejected | promoted (written to canonical tables).';

create trigger legacy_import_rows_updated_at
  before update on legacy_import_rows
  for each row execute function update_updated_at_column();

create index legacy_import_rows_sheet_id_idx  on legacy_import_rows (sheet_id);
create index legacy_import_rows_status_idx    on legacy_import_rows (status);
-- Supports "all flagged rows needing review"
create index legacy_import_rows_flagged_idx   on legacy_import_rows (sheet_id)
  where status = 'flagged';


-- ── legacy_import_issues ──────────────────────────────────────
-- Quality issues per legacy row. Uses the same issue_code
-- vocabulary as data_quality_issues.

create table legacy_import_issues (
  id          bigint      generated always as identity primary key,
  row_id      bigint      not null references legacy_import_rows(id),
  issue_code  text        not null,
  description text        not null,
  resolved    boolean     not null default false,
  resolved_by uuid        references profiles(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  legacy_import_issues           is 'Quality issues per legacy import row. Same issue_code vocabulary as data_quality_issues. Resolved by admin before the row can be approved.';
comment on column legacy_import_issues.issue_code is 'Same codes as data_quality_issues. See docs/architecture/import-pipeline.md.';

create trigger legacy_import_issues_updated_at
  before update on legacy_import_issues
  for each row execute function update_updated_at_column();

create index legacy_import_issues_row_id_idx on legacy_import_issues (row_id);
-- Supports "all unresolved issues for a row"
create index legacy_import_issues_open_idx   on legacy_import_issues (row_id)
  where resolved = false;


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- All import tables are admin-only read and write. Import
-- internals (raw payloads, run history, quality issues) are
-- tooling — managers have no need to query them directly.
--
-- raw_import_payloads is insert-only (no update/delete policies).
-- ─────────────────────────────────────────────────────────────


-- ── data_sources ──────────────────────────────────────────────

alter table data_sources enable row level security;

create policy "data_sources: admin read"
  on data_sources for select
  to authenticated
  using (is_admin());

create policy "data_sources: admin insert"
  on data_sources for insert
  to authenticated
  with check (is_admin());

create policy "data_sources: admin update"
  on data_sources for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "data_sources: admin delete"
  on data_sources for delete
  to authenticated
  using (is_admin());


-- ── import_runs ───────────────────────────────────────────────

alter table import_runs enable row level security;

create policy "import_runs: admin read"
  on import_runs for select
  to authenticated
  using (is_admin());

create policy "import_runs: admin insert"
  on import_runs for insert
  to authenticated
  with check (is_admin());

create policy "import_runs: admin update"
  on import_runs for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "import_runs: admin delete"
  on import_runs for delete
  to authenticated
  using (is_admin());


-- ── raw_import_payloads ───────────────────────────────────────
-- Insert-only: no update or delete policies.

alter table raw_import_payloads enable row level security;

create policy "raw_import_payloads: admin read"
  on raw_import_payloads for select
  to authenticated
  using (is_admin());

create policy "raw_import_payloads: admin insert"
  on raw_import_payloads for insert
  to authenticated
  with check (is_admin());


-- ── data_quality_issues ───────────────────────────────────────

alter table data_quality_issues enable row level security;

create policy "data_quality_issues: admin read"
  on data_quality_issues for select
  to authenticated
  using (is_admin());

create policy "data_quality_issues: admin insert"
  on data_quality_issues for insert
  to authenticated
  with check (is_admin());

create policy "data_quality_issues: admin update"
  on data_quality_issues for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "data_quality_issues: admin delete"
  on data_quality_issues for delete
  to authenticated
  using (is_admin());


-- ── legacy_import_files ───────────────────────────────────────

alter table legacy_import_files enable row level security;

create policy "legacy_import_files: admin read"
  on legacy_import_files for select
  to authenticated
  using (is_admin());

create policy "legacy_import_files: admin insert"
  on legacy_import_files for insert
  to authenticated
  with check (is_admin());

create policy "legacy_import_files: admin update"
  on legacy_import_files for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "legacy_import_files: admin delete"
  on legacy_import_files for delete
  to authenticated
  using (is_admin());


-- ── legacy_import_sheets ──────────────────────────────────────

alter table legacy_import_sheets enable row level security;

create policy "legacy_import_sheets: admin read"
  on legacy_import_sheets for select
  to authenticated
  using (is_admin());

create policy "legacy_import_sheets: admin insert"
  on legacy_import_sheets for insert
  to authenticated
  with check (is_admin());

create policy "legacy_import_sheets: admin update"
  on legacy_import_sheets for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "legacy_import_sheets: admin delete"
  on legacy_import_sheets for delete
  to authenticated
  using (is_admin());


-- ── legacy_import_rows ────────────────────────────────────────

alter table legacy_import_rows enable row level security;

create policy "legacy_import_rows: admin read"
  on legacy_import_rows for select
  to authenticated
  using (is_admin());

create policy "legacy_import_rows: admin insert"
  on legacy_import_rows for insert
  to authenticated
  with check (is_admin());

create policy "legacy_import_rows: admin update"
  on legacy_import_rows for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "legacy_import_rows: admin delete"
  on legacy_import_rows for delete
  to authenticated
  using (is_admin());


-- ── legacy_import_issues ──────────────────────────────────────

alter table legacy_import_issues enable row level security;

create policy "legacy_import_issues: admin read"
  on legacy_import_issues for select
  to authenticated
  using (is_admin());

create policy "legacy_import_issues: admin insert"
  on legacy_import_issues for insert
  to authenticated
  with check (is_admin());

create policy "legacy_import_issues: admin update"
  on legacy_import_issues for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "legacy_import_issues: admin delete"
  on legacy_import_issues for delete
  to authenticated
  using (is_admin());
