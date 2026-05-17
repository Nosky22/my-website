-- Enable Realtime for the two tables that drive the live draft room.
-- Without this, postgres_changes subscriptions in useDraftPicks and
-- useDraftSession receive no events despite being correctly subscribed.
ALTER PUBLICATION supabase_realtime ADD TABLE draft_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE draft_sessions;
