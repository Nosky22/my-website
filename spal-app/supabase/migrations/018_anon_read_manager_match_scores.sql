-- Allow anonymous read on manager_match_scores so public pages (season review,
-- history) can display round-by-round and per-manager scoring without login.
-- The table contains score history only — no PII, no sensitive state.
-- Additive: the existing authenticated SELECT policy is unchanged.

CREATE POLICY "manager_match_scores_anon_read"
  ON public.manager_match_scores
  FOR SELECT
  TO anon
  USING (true);
