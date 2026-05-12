-- ============================================================
-- SPAL Migration 004 — Standings
-- season_standings: season-level aggregated standings per manager
--
-- Prerequisites: 001_foundation.sql (seasons, profiles)
--                003_squad_scoring.sql (manager_match_scores,
--                  fixture_group_members — source of truth for values)
-- Additive only — no existing tables altered or dropped
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── season_standings ──────────────────────────────────────────
-- One row per manager per season. Maintained by the scoring Edge
-- Function after each round is finalised.
--
-- Covers both the total-points table and the H2H league table.
-- Ranks are not stored here — they are derived at query time with
-- window functions (RANK() OVER ...) so they never go stale.
--
-- W/D/L definition applies to both pairs and triples:
--   win  = group_place 1 (highest score in the fixture group)
--   draw = group_place 2
--   loss = group_place 3

create table season_standings (
  id            bigint        generated always as identity primary key,
  season_id     bigint        not null references seasons(id),
  profile_id    uuid          not null references profiles(id),
  rounds_played int           not null default 0,
  total_points  numeric(8,2)  not null default 0,
  h2h_points    int           not null default 0,
  h2h_wins      int           not null default 0,
  h2h_draws     int           not null default 0,
  h2h_losses    int           not null default 0,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),

  -- One standings row per manager per season
  constraint season_standings_unique unique (season_id, profile_id),
  constraint season_standings_rounds_non_negative  check (rounds_played >= 0),
  constraint season_standings_h2h_wins_non_negative  check (h2h_wins    >= 0),
  constraint season_standings_h2h_draws_non_negative check (h2h_draws   >= 0),
  constraint season_standings_h2h_losses_non_negative check (h2h_losses >= 0)
);

comment on table  season_standings             is 'Season-level aggregated standings per manager. Updated by the scoring engine after each round is finalised. Covers both the total-points table and the H2H league table. Ranks are derived at query time.';
comment on column season_standings.rounds_played is 'Count of rounds with at least one finalised fixture_group_members row for this manager.';
comment on column season_standings.total_points  is 'Cumulative sum of manager_match_scores.final_points across all scored rounds.';
comment on column season_standings.h2h_points    is 'Cumulative sum of fixture_group_members.h2h_points. Primary H2H table sort key.';
comment on column season_standings.h2h_wins      is 'Rounds where group_place = 1 (highest score in the fixture group).';
comment on column season_standings.h2h_draws     is 'Rounds where group_place = 2.';
comment on column season_standings.h2h_losses    is 'Rounds where group_place = 3.';

create trigger season_standings_updated_at
  before update on season_standings
  for each row execute function update_updated_at_column();

create index season_standings_season_id_idx  on season_standings (season_id);
create index season_standings_profile_id_idx on season_standings (profile_id);
-- Supports the primary standings query: all managers for a season ordered by H2H points then total points
create index season_standings_h2h_rank_idx   on season_standings (season_id, h2h_points desc, total_points desc);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────


alter table season_standings enable row level security;

-- Standings are displayed on the public-facing standings page
create policy "season_standings: public read"
  on season_standings for select
  to anon, authenticated
  using (true);

create policy "season_standings: admin insert"
  on season_standings for insert
  to authenticated
  with check (is_admin());

create policy "season_standings: admin update"
  on season_standings for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "season_standings: admin delete"
  on season_standings for delete
  to authenticated
  using (is_admin());
