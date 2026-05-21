-- merge_profiles: atomically reassigns all profile-keyed data from a placeholder
-- account to a real account, then deletes the placeholder profile row.
--
-- Called exclusively from the merge-profiles Edge Function (service role).
-- All validation is done here so the operation is atomic.
--
-- Returns a JSON summary of what was moved.

CREATE OR REPLACE FUNCTION public.merge_profiles(
  placeholder_id uuid,
  real_id        uuid,
  admin_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_placeholder_email text;
  v_real_email        text;
  v_admin_is_admin    boolean;
  v_display_name      text;
  v_team_name         text;

  v_draft_order_rows          int;
  v_draft_picks_rows          int;
  v_manager_round_squads_rows int;
  v_manager_match_scores_rows int;
  v_fixture_group_members_rows int;
  v_season_standings_rows     int;
  v_league_penalties_rows     int;
BEGIN
  -- ── 1. Sanity: IDs must differ ───────────────────────────────────────────
  IF placeholder_id = real_id THEN
    RAISE EXCEPTION 'placeholder_id and real_id must be different';
  END IF;

  -- ── 2. Both must exist in auth.users ─────────────────────────────────────
  SELECT email INTO v_placeholder_email
  FROM auth.users WHERE id = placeholder_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'placeholder user % not found in auth.users', placeholder_id;
  END IF;

  SELECT email INTO v_real_email
  FROM auth.users WHERE id = real_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'real user % not found in auth.users', real_id;
  END IF;

  -- ── 3. Source must be a placeholder account ───────────────────────────────
  IF v_placeholder_email NOT LIKE '%@spal.placeholder' THEN
    RAISE EXCEPTION 'source account % is not a placeholder account', v_placeholder_email;
  END IF;

  -- ── 4. Target must NOT be a placeholder account ───────────────────────────
  IF v_real_email LIKE '%@spal.placeholder' THEN
    RAISE EXCEPTION 'target account % is itself a placeholder account', v_real_email;
  END IF;

  -- ── 5. Caller must be an admin ────────────────────────────────────────────
  SELECT is_admin INTO v_admin_is_admin
  FROM public.profiles WHERE id = admin_id;
  IF NOT FOUND OR NOT v_admin_is_admin THEN
    RAISE EXCEPTION 'caller % is not an admin', admin_id;
  END IF;

  -- ── 6. Capture placeholder display_name / team_name before update ─────────
  SELECT display_name, team_name
  INTO v_display_name, v_team_name
  FROM public.profiles WHERE id = placeholder_id;

  -- ── 7. Reassign all profile-keyed data ───────────────────────────────────

  UPDATE public.draft_order SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_draft_order_rows = ROW_COUNT;

  UPDATE public.draft_picks SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_draft_picks_rows = ROW_COUNT;

  UPDATE public.manager_round_squads SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_manager_round_squads_rows = ROW_COUNT;

  UPDATE public.manager_match_scores SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_manager_match_scores_rows = ROW_COUNT;

  UPDATE public.fixture_group_members SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_fixture_group_members_rows = ROW_COUNT;

  UPDATE public.season_standings SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_season_standings_rows = ROW_COUNT;

  UPDATE public.league_penalties SET profile_id = real_id WHERE profile_id = placeholder_id;
  GET DIAGNOSTICS v_league_penalties_rows = ROW_COUNT;

  -- ── 8. Copy display_name / team_name from placeholder to real account ─────
  UPDATE public.profiles
  SET display_name = v_display_name,
      team_name    = v_team_name
  WHERE id = real_id;

  -- ── 9. Delete placeholder profile row ─────────────────────────────────────
  -- If any rows still reference placeholder_id the FK (NO ACTION) will raise
  -- an exception here, preventing a partial merge.
  DELETE FROM public.profiles WHERE id = placeholder_id;

  -- ── 10. Audit log ─────────────────────────────────────────────────────────
  INSERT INTO public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    season_id,
    metadata
  ) VALUES (
    admin_id,
    'profile.merged',
    'profile',
    placeholder_id::text,
    NULL,
    jsonb_build_object(
      'placeholder_id',    placeholder_id,
      'placeholder_email', v_placeholder_email,
      'real_id',           real_id,
      'real_email',        v_real_email,
      'display_name',      v_display_name,
      'team_name',         v_team_name,
      'rows_moved', jsonb_build_object(
        'draft_order',            v_draft_order_rows,
        'draft_picks',            v_draft_picks_rows,
        'manager_round_squads',   v_manager_round_squads_rows,
        'manager_match_scores',   v_manager_match_scores_rows,
        'fixture_group_members',  v_fixture_group_members_rows,
        'season_standings',       v_season_standings_rows,
        'league_penalties',       v_league_penalties_rows
      )
    )
  );

  -- ── 11. Return summary ────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'placeholder_id',    placeholder_id,
    'placeholder_email', v_placeholder_email,
    'real_id',           real_id,
    'real_email',        v_real_email,
    'display_name',      v_display_name,
    'team_name',         v_team_name,
    'rows_moved', jsonb_build_object(
      'draft_order',            v_draft_order_rows,
      'draft_picks',            v_draft_picks_rows,
      'manager_round_squads',   v_manager_round_squads_rows,
      'manager_match_scores',   v_manager_match_scores_rows,
      'fixture_group_members',  v_fixture_group_members_rows,
      'season_standings',       v_season_standings_rows,
      'league_penalties',       v_league_penalties_rows
    )
  );
END;
$$;

-- Only the service role (Edge Functions) may call this function.
REVOKE EXECUTE ON FUNCTION public.merge_profiles(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.merge_profiles(uuid, uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.merge_profiles(uuid, uuid, uuid) TO service_role;
