-- ============================================================
-- Migration 010: add pick_deadline to draft_sessions
--
-- Adds a nullable timestamptz column to track when the current
-- pick expires. Set by the Edge Function to now() + pick_timer_seconds
-- on each pick; used by all clients to drive the countdown display.
--
-- Additive only — no existing data modified, no columns dropped.
-- ============================================================

alter table draft_sessions
  add column pick_deadline timestamptz;

comment on column draft_sessions.pick_deadline is
  'Timestamp when the current pick expires. Set to now() + pick_timer_seconds on each pick. Null until the draft goes active.';
