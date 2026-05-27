-- Add 'test' to the seasons status check constraint.
-- Requires drop + recreate; no data is modified.
ALTER TABLE public.seasons
  DROP CONSTRAINT seasons_status_check;

ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_status_check
  CHECK (status IN ('setup', 'test', 'active', 'live', 'complete', 'historical'));
