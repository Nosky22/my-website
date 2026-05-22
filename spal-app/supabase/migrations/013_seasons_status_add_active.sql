-- Add 'active' to the seasons status check constraint.
-- The original constraint only allowed setup/historical/live/complete;
-- 'active' is used by the dashboard to identify the current season.
ALTER TABLE public.seasons
  DROP CONSTRAINT seasons_status_check,
  ADD  CONSTRAINT seasons_status_check
    CHECK (status = ANY (ARRAY['active','setup','historical','live','complete']));
