-- Migration 023: Add ON DELETE CASCADE to all FK constraints referencing seasons.id
-- Also adds CASCADE to indirect child tables that have no direct seasons FK.
-- Effect: DELETE FROM seasons WHERE year = X will cleanly remove all dependent data.
-- Reversible: constraints can be recreated with NO ACTION at any time. No data is modified.

-- Direct children of seasons (21 tables)
ALTER TABLE admin_overrides
  DROP CONSTRAINT admin_overrides_season_id_fkey,
  ADD CONSTRAINT admin_overrides_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE audit_log
  DROP CONSTRAINT audit_log_season_id_fkey,
  ADD CONSTRAINT audit_log_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE draft_order
  DROP CONSTRAINT draft_order_season_id_fkey,
  ADD CONSTRAINT draft_order_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE draft_picks
  DROP CONSTRAINT draft_picks_season_id_fkey,
  ADD CONSTRAINT draft_picks_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE draft_sessions
  DROP CONSTRAINT draft_sessions_season_id_fkey,
  ADD CONSTRAINT draft_sessions_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE fixture_group_members
  DROP CONSTRAINT fixture_group_members_season_id_fkey,
  ADD CONSTRAINT fixture_group_members_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE fixture_groups
  DROP CONSTRAINT fixture_groups_season_id_fkey,
  ADD CONSTRAINT fixture_groups_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE import_runs
  DROP CONSTRAINT import_runs_season_id_fkey,
  ADD CONSTRAINT import_runs_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE league_penalties
  DROP CONSTRAINT league_penalties_season_id_fkey,
  ADD CONSTRAINT league_penalties_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE legacy_import_files
  DROP CONSTRAINT legacy_import_files_season_id_fkey,
  ADD CONSTRAINT legacy_import_files_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE manager_match_scores
  DROP CONSTRAINT manager_match_scores_season_id_fkey,
  ADD CONSTRAINT manager_match_scores_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE manager_round_squads
  DROP CONSTRAINT manager_round_squads_season_id_fkey,
  ADD CONSTRAINT manager_round_squads_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE matches
  DROP CONSTRAINT matches_season_id_fkey,
  ADD CONSTRAINT matches_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE player_match_scores
  DROP CONSTRAINT player_match_scores_season_id_fkey,
  ADD CONSTRAINT player_match_scores_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE player_prices
  DROP CONSTRAINT player_prices_season_id_fkey,
  ADD CONSTRAINT player_prices_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE players
  DROP CONSTRAINT players_season_id_fkey,
  ADD CONSTRAINT players_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE predo_predictions
  DROP CONSTRAINT predo_predictions_season_id_fkey,
  ADD CONSTRAINT predo_predictions_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE predo_scores
  DROP CONSTRAINT predo_scores_season_id_fkey,
  ADD CONSTRAINT predo_scores_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE round_insights
  DROP CONSTRAINT round_insights_season_id_fkey,
  ADD CONSTRAINT round_insights_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE season_rules
  DROP CONSTRAINT season_rules_season_id_fkey,
  ADD CONSTRAINT season_rules_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

ALTER TABLE season_standings
  DROP CONSTRAINT season_standings_season_id_fkey,
  ADD CONSTRAINT season_standings_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;

-- Indirect children: no direct seasons FK, would block cascade via their parent tables
ALTER TABLE matchday_squads
  DROP CONSTRAINT matchday_squads_match_id_fkey,
  ADD CONSTRAINT matchday_squads_match_id_fkey
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE predo_results
  DROP CONSTRAINT predo_results_match_id_fkey,
  ADD CONSTRAINT predo_results_match_id_fkey
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE data_quality_issues
  DROP CONSTRAINT data_quality_issues_import_run_id_fkey,
  ADD CONSTRAINT data_quality_issues_import_run_id_fkey
    FOREIGN KEY (import_run_id) REFERENCES import_runs(id) ON DELETE CASCADE;

ALTER TABLE raw_import_payloads
  DROP CONSTRAINT raw_import_payloads_import_run_id_fkey,
  ADD CONSTRAINT raw_import_payloads_import_run_id_fkey
    FOREIGN KEY (import_run_id) REFERENCES import_runs(id) ON DELETE CASCADE;

ALTER TABLE legacy_import_sheets
  DROP CONSTRAINT legacy_import_sheets_file_id_fkey,
  ADD CONSTRAINT legacy_import_sheets_file_id_fkey
    FOREIGN KEY (file_id) REFERENCES legacy_import_files(id) ON DELETE CASCADE;
