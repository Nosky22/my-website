-- Migration 024: Reset season progress function
-- Deletes all scored/predicted/squad progress for a season while keeping the
-- structural setup: draft results, player pool, fixtures, team sheets, rules.
-- Only callable by authenticated admins (enforced inside the function via is_admin()).

CREATE OR REPLACE FUNCTION public.reset_season_progress(p_season_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted jsonb := '{}';
  v_count   int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;

  -- manager_round_squad_players cascades from manager_round_squads, no direct delete needed.
  DELETE FROM manager_round_squads WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('manager_round_squads', v_count);

  DELETE FROM predo_predictions WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('predo_predictions', v_count);

  DELETE FROM predo_scores WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('predo_scores', v_count);

  -- predo_results has no direct season_id; join via matches.
  DELETE FROM predo_results
  WHERE match_id IN (SELECT id FROM matches WHERE season_id = p_season_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('predo_results', v_count);

  DELETE FROM manager_match_scores WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('manager_match_scores', v_count);

  DELETE FROM player_match_scores WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('player_match_scores', v_count);

  DELETE FROM season_standings WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('season_standings', v_count);

  DELETE FROM round_insights WHERE season_id = p_season_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('round_insights', v_count);

  RETURN v_deleted;
END;
$$;

-- Revoke from PUBLIC, grant only to authenticated (is_admin() check inside).
REVOKE ALL ON FUNCTION public.reset_season_progress(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_season_progress(bigint) TO authenticated;
