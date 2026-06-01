-- Migration 019: Predos score prediction competition
--
-- Creates three tables:
--   predo_predictions  — one row per manager per match
--   predo_results      — one row per match (entered by admin once result known)
--   predo_scores       — calculated per-manager per-round totals
--
-- RLS on predo_predictions uses the existing matches.kickoff_at column to
-- enforce the round deadline: managers can write predictions until the first
-- kickoff of the round passes (or while all kickoff_at values are NULL).

-- ── predo_predictions ──────────────────────────────────────────────────────────

CREATE TABLE public.predo_predictions (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id        bigint      NOT NULL REFERENCES public.seasons(id),
  profile_id       uuid        NOT NULL REFERENCES public.profiles(id),
  match_id         bigint      NOT NULL REFERENCES public.matches(id),
  predicted_winner text        NOT NULL,
  predicted_margin int         NOT NULL DEFAULT 0 CHECK (predicted_margin >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, match_id)
);

ALTER TABLE public.predo_predictions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER predo_predictions_updated_at
  BEFORE UPDATE ON public.predo_predictions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Managers always see their own predictions.
CREATE POLICY "predo_predictions_own_read"
  ON public.predo_predictions
  FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);

-- Everyone (including anon) sees all predictions once the first kickoff of the
-- match's round has passed.
CREATE POLICY "predo_predictions_public_read_after_deadline"
  ON public.predo_predictions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.season_id   = predo_predictions.season_id
        AND m.round_number = (
          SELECT round_number FROM public.matches WHERE id = predo_predictions.match_id
        )
        AND m.kickoff_at IS NOT NULL
        AND m.kickoff_at <= now()
    )
  );

-- Managers can insert/update their own predictions before the round deadline.
-- If no kickoff times are set the deadline is treated as not-yet-passed (NULL = open).
CREATE POLICY "predo_predictions_manager_insert"
  ON public.predo_predictions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = profile_id
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.season_id   = predo_predictions.season_id
        AND m.round_number = (
          SELECT round_number FROM public.matches WHERE id = predo_predictions.match_id
        )
        AND m.kickoff_at IS NOT NULL
        AND m.kickoff_at <= now()
    )
  );

CREATE POLICY "predo_predictions_manager_update"
  ON public.predo_predictions
  FOR UPDATE TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (
    auth.uid() = profile_id
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.season_id   = predo_predictions.season_id
        AND m.round_number = (
          SELECT round_number FROM public.matches WHERE id = predo_predictions.match_id
        )
        AND m.kickoff_at IS NOT NULL
        AND m.kickoff_at <= now()
    )
  );

-- Admin full access.
CREATE POLICY "predo_predictions_admin_all"
  ON public.predo_predictions
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── predo_results ──────────────────────────────────────────────────────────────

CREATE TABLE public.predo_results (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id       bigint NOT NULL REFERENCES public.matches(id) UNIQUE,
  actual_winner  text   NOT NULL,
  actual_margin  int    NOT NULL DEFAULT 0 CHECK (actual_margin >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.predo_results ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER predo_results_updated_at
  BEFORE UPDATE ON public.predo_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE POLICY "predo_results_public_read"
  ON public.predo_results
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "predo_results_admin_write"
  ON public.predo_results
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── predo_scores ───────────────────────────────────────────────────────────────
-- numeric(5,1) for all points columns: tie-sharing can produce 0.5 increments.

CREATE TABLE public.predo_scores (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id            bigint       NOT NULL REFERENCES public.seasons(id),
  profile_id           uuid         NOT NULL REFERENCES public.profiles(id),
  round_number         int          NOT NULL,
  winning_team_points  numeric(5,1) NOT NULL DEFAULT 0,
  margin_points        numeric(5,1) NOT NULL DEFAULT 0,
  total_points         numeric(5,1) NOT NULL DEFAULT 0,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (season_id, profile_id, round_number)
);

ALTER TABLE public.predo_scores ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER predo_scores_updated_at
  BEFORE UPDATE ON public.predo_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE POLICY "predo_scores_public_read"
  ON public.predo_scores
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "predo_scores_admin_write"
  ON public.predo_scores
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
