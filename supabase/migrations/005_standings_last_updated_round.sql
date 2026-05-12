-- ============================================================
-- SPAL Migration 005 — Add last_updated_round to season_standings
--
-- Additive only: one nullable column added to season_standings.
-- No data affected. Reversible by dropping the column.
-- ============================================================

alter table season_standings
  add column last_updated_round int;

comment on column season_standings.last_updated_round is 'The round after which these standings were last calculated. Null until the first round is finalised. Lets the UI display "standings after round N" without querying match data.';
