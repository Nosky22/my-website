-- ============================================================
-- SPAL Migration 008 — Extend position_group check constraint
--
-- Adds 'Other' as a valid position_group value for players
-- whose position (Second Row, Scrum-half, Fly-half, Centre)
-- has no dedicated draft slot.
--
-- Additive only: all existing rows have values in the original
-- set and remain valid. No data is modified.
-- ============================================================

alter table players drop constraint players_position_group_check;

alter table players add constraint players_position_group_check
  check (position_group in ('Front Row', 'Back Row', 'Outside Back', 'Other'));
