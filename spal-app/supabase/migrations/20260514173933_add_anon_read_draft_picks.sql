-- Allow unauthenticated (anon) reads on draft_picks so public pages
-- (players, draft board, standings) can display draft data without login.
-- The original auth-only policy was appropriate for a live draft; the 2026
-- season is historical, and results are intended to be publicly visible.
create policy "draft_picks_anon_read"
  on draft_picks
  for select
  to anon
  using (true);
