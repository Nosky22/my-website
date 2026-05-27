-- Realtime DELETE events on draft_picks use a season_id filter.
-- With REPLICA IDENTITY DEFAULT only the PK is in the WAL on DELETE,
-- so Supabase Realtime cannot evaluate the season_id filter and drops
-- the event. FULL ensures all column values are written on DELETE.
ALTER TABLE public.draft_picks REPLICA IDENTITY FULL;
