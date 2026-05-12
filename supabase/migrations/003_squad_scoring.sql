-- ============================================================
-- SPAL Migration 003 — Squad and scoring tables
-- matches, matchday_squads, player_match_scores,
-- manager_round_squads, manager_round_squad_players,
-- manager_match_scores, fixture_groups, fixture_group_members
--
-- Prerequisites: 001_foundation.sql (seasons, profiles, players)
-- Note: leagues/league_members deliberately omitted — see ADR 0005
-- Additive only — no existing tables altered or dropped
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── matches ──────────────────────────────────────────────────
-- The Six Nations fixture schedule. One row per match per season.
-- Each pair of nations plays exactly once per season (unique constraint).
-- Kickoff times may be null until the tournament schedule is published.

create table matches (
  id           bigint      generated always as identity primary key,
  season_id    bigint      not null references seasons(id),
  round_number int         not null,
  home_nation  text        not null,
  away_nation  text        not null,
  kickoff_at   timestamptz,
  status       text        not null default 'scheduled',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint matches_pair_unique unique (season_id, home_nation, away_nation),
  constraint matches_no_self_play check (home_nation != away_nation),
  constraint matches_round_positive check (round_number >= 1),
  constraint matches_status_check
    check (status in ('scheduled', 'live', 'complete')),
  constraint matches_home_nation_check
    check (home_nation in ('England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy')),
  constraint matches_away_nation_check
    check (away_nation in ('England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy'))
);

comment on table  matches              is 'Six Nations fixture schedule. One row per match per season; each pair of nations plays exactly once.';
comment on column matches.round_number is 'Six Nations round (1–5).';
comment on column matches.kickoff_at   is 'UTC kickoff time. Null until the official schedule is published.';
comment on column matches.status       is 'scheduled | live | complete.';

create trigger matches_updated_at
  before update on matches
  for each row execute function update_updated_at_column();

create index matches_season_id_idx     on matches (season_id);
create index matches_season_round_idx  on matches (season_id, round_number);
create index matches_status_idx        on matches (status);


-- ── matchday_squads ───────────────────────────────────────────
-- Player selection per match: starting XV, bench, not selected.
-- Populated by the import pipeline. Used to resolve Supersub status
-- (bench = 3× multiplier, starting = 0.5×, not played = 0).

create table matchday_squads (
  id           bigint      generated always as identity primary key,
  match_id     bigint      not null references matches(id),
  player_id    bigint      not null references players(id),
  shirt_number int,
  status       text        not null default 'unknown',
  source       text,
  imported_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One selection status per player per match
  constraint matchday_squads_player_match_unique unique (match_id, player_id),
  constraint matchday_squads_status_check
    check (status in ('starting', 'bench', 'not_selected', 'unknown'))
);

comment on table  matchday_squads        is 'Player selection per match (starting/bench/not_selected). Imported from the official feed; drives Supersub multiplier resolution.';
comment on column matchday_squads.status is 'starting | bench | not_selected | unknown. Unknown is the default until the official squad is announced.';
comment on column matchday_squads.source is 'Which import adapter provided this status.';

create trigger matchday_squads_updated_at
  before update on matchday_squads
  for each row execute function update_updated_at_column();

create index matchday_squads_match_id_idx  on matchday_squads (match_id);
create index matchday_squads_player_id_idx on matchday_squads (player_id);


-- ── player_match_scores ───────────────────────────────────────
-- Raw player points per match. One row per player per match,
-- created when scores are imported. Admin can override via
-- admin_override_points; final_points is the generated resolution.

create table player_match_scores (
  id                    bigint        generated always as identity primary key,
  match_id              bigint        not null references matches(id),
  player_id             bigint        not null references players(id),
  season_id             bigint        not null references seasons(id),
  source_points         numeric(8,2),
  admin_override_points numeric(8,2),
  -- Generated: override takes precedence over import.
  final_points          numeric(8,2)  generated always as (coalesce(admin_override_points, source_points)) stored,
  status                text          not null default 'provisional',
  imported_at           timestamptz   not null default now(),
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),

  -- One score row per player per match
  constraint player_match_scores_player_match_unique unique (match_id, player_id),
  constraint player_match_scores_status_check
    check (status in ('provisional', 'final', 'corrected'))
);

comment on table  player_match_scores                       is 'Player points per match. final_points is admin_override_points ?? source_points (generated column).';
comment on column player_match_scores.source_points         is 'Points as imported from the official or manual source.';
comment on column player_match_scores.admin_override_points is 'Admin correction; supersedes source_points. Overrides must also be logged in admin_overrides (later migration).';
comment on column player_match_scores.final_points          is 'Generated column: admin_override_points ?? source_points. Input to the scoring engine.';
comment on column player_match_scores.status                is 'provisional | final | corrected.';

create trigger player_match_scores_updated_at
  before update on player_match_scores
  for each row execute function update_updated_at_column();

create index player_match_scores_match_id_idx  on player_match_scores (match_id);
create index player_match_scores_player_id_idx on player_match_scores (player_id);
create index player_match_scores_season_id_idx on player_match_scores (season_id);


-- ── manager_round_squads ──────────────────────────────────────
-- A manager's submitted squad for one round.
-- One squad per manager per round. Squads lock at first match kickoff
-- (default; configurable via season_rules). squad_lock_rule drives the
-- lock Edge Function — this table just records the locked_at timestamp.

create table manager_round_squads (
  id           bigint      generated always as identity primary key,
  season_id    bigint      not null references seasons(id),
  profile_id   uuid        not null references profiles(id),
  round_number int         not null,
  status       text        not null default 'draft',
  submitted_at timestamptz,
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- One squad per manager per round
  constraint manager_round_squads_unique unique (season_id, profile_id, round_number),
  constraint manager_round_squads_round_positive check (round_number >= 1),
  constraint manager_round_squads_status_check
    check (status in ('draft', 'submitted', 'locked'))
);

comment on table  manager_round_squads              is 'A manager''s squad for one round, moving through draft → submitted → locked.';
comment on column manager_round_squads.status       is 'draft = saved, not yet submitted; submitted = manager confirmed; locked = first kickoff passed, immutable.';
comment on column manager_round_squads.submitted_at is 'When the manager explicitly submitted (before lock).';
comment on column manager_round_squads.locked_at    is 'When the squad was locked by the lock Edge Function (first match kickoff by default).';

create trigger manager_round_squads_updated_at
  before update on manager_round_squads
  for each row execute function update_updated_at_column();

create index manager_round_squads_season_id_idx    on manager_round_squads (season_id);
create index manager_round_squads_profile_id_idx   on manager_round_squads (profile_id);
create index manager_round_squads_season_round_idx on manager_round_squads (season_id, round_number);


-- ── manager_round_squad_players ───────────────────────────────
-- The 15 starters + 1 Supersub in a manager's round squad.
-- Partial unique indexes enforce the "exactly one captain" and
-- "exactly one supersub" rules at the database level.
-- Cascades on squad delete so removing a squad cleans up its players.

create table manager_round_squad_players (
  id         bigint      generated always as identity primary key,
  squad_id   bigint      not null references manager_round_squads(id) on delete cascade,
  player_id  bigint      not null references players(id),
  role       text        not null default 'starter',
  is_captain boolean     not null default false,
  created_at timestamptz not null default now(),

  -- A player appears at most once per squad
  constraint squad_players_player_unique unique (squad_id, player_id),
  constraint squad_players_role_check check (role in ('starter', 'supersub'))
);

-- At most one captain per squad
create unique index squad_players_captain_unique_idx
  on manager_round_squad_players (squad_id)
  where is_captain = true;

-- At most one supersub per squad
create unique index squad_players_supersub_unique_idx
  on manager_round_squad_players (squad_id)
  where role = 'supersub';

comment on table  manager_round_squad_players           is 'The 15 starters + 1 Supersub in a round squad. Cascades on squad delete.';
comment on column manager_round_squad_players.role      is 'starter (counts towards 15) or supersub (16th slot, separate multiplier).';
comment on column manager_round_squad_players.is_captain is 'Exactly one starter per squad must be captain (×2 multiplier). Enforced by partial unique index.';

create index squad_players_squad_id_idx  on manager_round_squad_players (squad_id);
create index squad_players_player_id_idx on manager_round_squad_players (player_id);


-- ── manager_match_scores ──────────────────────────────────────
-- Computed manager score for one match. Populated by the scoring
-- Edge Function after match scores are imported.
--
-- Points flow:
--   starters_raw_points  sum of all 15 starters' final_points (pre-captain multiplier)
--   adjusted_points      after captain ×2 and supersub multiplier applied
--   final_points         after any admin penalties
--
-- The supersub calculation is stored in decomposed form so it can be
-- recalculated if the multiplier values change in season_rules without
-- re-reading every player score:
--   supersub_raw_points  × supersub_multiplier_applied = supersub contribution
--   adjusted_points      = starters_raw_points + captain_bonus + supersub contribution
--
-- captain_bonus is implicitly: captain's final_points (already in starters_raw_points)
-- counted once more. Not stored separately as only the supersub multiplier was
-- identified as change-prone in v0.1.

create table manager_match_scores (
  id                        bigint        generated always as identity primary key,
  squad_id                  bigint        not null references manager_round_squads(id),
  match_id                  bigint        not null references matches(id),
  profile_id                uuid          not null references profiles(id),
  season_id                 bigint        not null references seasons(id),
  starters_raw_points       numeric(8,2),
  supersub_raw_points       numeric(8,2),
  supersub_multiplier_applied numeric(4,2),
  adjusted_points           numeric(8,2),
  final_points              numeric(8,2),
  status                    text          not null default 'provisional',
  created_at                timestamptz   not null default now(),
  updated_at                timestamptz   not null default now(),

  -- One score entry per squad per match
  constraint manager_match_scores_unique unique (squad_id, match_id),
  constraint manager_match_scores_status_check
    check (status in ('provisional', 'final'))
);

comment on table  manager_match_scores                             is 'Manager score for one match, computed by the scoring engine. Decomposed to support supersub multiplier recalculation.';
comment on column manager_match_scores.starters_raw_points        is 'Sum of all 15 starters'' final_points before captain multiplier.';
comment on column manager_match_scores.supersub_raw_points        is 'Supersub player''s final_points from player_match_scores. Stored separately to allow multiplier recalculation.';
comment on column manager_match_scores.supersub_multiplier_applied is 'The multiplier used when adjusted_points was calculated (from season_rules: 3.0 bench, 0.5 starting, 0.0 not played).';
comment on column manager_match_scores.adjusted_points            is 'starters_raw_points + captain bonus (captain''s points counted twice) + supersub_raw_points × supersub_multiplier_applied.';
comment on column manager_match_scores.final_points               is 'adjusted_points after any admin penalties. The value used for H2H and standings.';
comment on column manager_match_scores.status                     is 'provisional = scores not yet finalised; final = confirmed.';

create trigger manager_match_scores_updated_at
  before update on manager_match_scores
  for each row execute function update_updated_at_column();

create index manager_match_scores_squad_id_idx    on manager_match_scores (squad_id);
create index manager_match_scores_match_id_idx    on manager_match_scores (match_id);
create index manager_match_scores_profile_id_idx  on manager_match_scores (profile_id);
create index manager_match_scores_season_id_idx   on manager_match_scores (season_id);
-- Supports "all manager scores for a season in match order" — primary standings query
create index manager_match_scores_season_match_idx on manager_match_scores (season_id, match_id);


-- ── fixture_groups ────────────────────────────────────────────
-- One H2H fixture per round: pair (2 managers) or triple (3 managers,
-- used in odd-number leagues). Set by admin or the fixture generator
-- before the season begins.

create table fixture_groups (
  id           bigint      generated always as identity primary key,
  season_id    bigint      not null references seasons(id),
  round_number int         not null,
  fixture_type text        not null default 'pair',
  status       text        not null default 'scheduled',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint fixture_groups_round_positive check (round_number >= 1),
  constraint fixture_groups_type_check
    check (fixture_type in ('pair', 'triple')),
  constraint fixture_groups_status_check
    check (status in ('scheduled', 'complete'))
);

comment on table  fixture_groups              is 'One H2H fixture per round: pair (2 managers) or triple (3 managers for odd-number leagues).';
comment on column fixture_groups.fixture_type is 'pair = standard H2H (win 4/draw 2/loss 0). triple = three-way (1st 4/2nd 2/3rd 0 with configurable tie handling).';
comment on column fixture_groups.status       is 'scheduled | complete. Set to complete by the scoring engine after H2H points are awarded.';

create trigger fixture_groups_updated_at
  before update on fixture_groups
  for each row execute function update_updated_at_column();

create index fixture_groups_season_id_idx    on fixture_groups (season_id);
create index fixture_groups_season_round_idx on fixture_groups (season_id, round_number);


-- ── fixture_group_members ─────────────────────────────────────
-- The managers in each H2H fixture group, with their round score,
-- placing, and resulting H2H league points. Populated by the scoring
-- Edge Function after all match scores for the round are final.

create table fixture_group_members (
  id               bigint        generated always as identity primary key,
  fixture_group_id bigint        not null references fixture_groups(id),
  profile_id       uuid          not null references profiles(id),
  season_id        bigint        not null references seasons(id),
  round_points     numeric(8,2),
  group_place      int,
  h2h_points       int,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),

  -- Each manager appears once per fixture group
  constraint fixture_group_members_unique unique (fixture_group_id, profile_id),
  constraint fixture_group_members_place_check
    check (group_place is null or group_place between 1 and 3)
);

comment on table  fixture_group_members             is 'Managers in an H2H fixture group with their round score, placing, and H2H points awarded.';
comment on column fixture_group_members.round_points is 'Sum of manager_match_scores.final_points across all matches in the round.';
comment on column fixture_group_members.group_place  is '1st, 2nd, or 3rd within the group. Null until the round is finalised.';
comment on column fixture_group_members.h2h_points   is 'H2H league points (win=4, draw=2, loss=0 for pairs; 4/2/0 for triples; tie handling from season_rules).';

create trigger fixture_group_members_updated_at
  before update on fixture_group_members
  for each row execute function update_updated_at_column();

create index fixture_group_members_group_id_idx   on fixture_group_members (fixture_group_id);
create index fixture_group_members_profile_id_idx on fixture_group_members (profile_id);
create index fixture_group_members_season_id_idx  on fixture_group_members (season_id);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
--
-- Visibility model:
--   Public (anon + authenticated): matches, matchday_squads, player_match_scores
--     — displayed on public standings and history pages
--   Authenticated only: squad and scoring tables
--     — squad selection and H2H results are league-private
--
-- Write: admin-only except manager_round_squads and
--   manager_round_squad_players, which managers can modify for their
--   own non-locked squads as a fallback. Edge Functions (service role)
--   bypass RLS for all enforced write paths.
-- ─────────────────────────────────────────────────────────────


-- ── matches ──────────────────────────────────────────────────

alter table matches enable row level security;

create policy "matches: public read"
  on matches for select
  to anon, authenticated
  using (true);

create policy "matches: admin insert"
  on matches for insert
  to authenticated
  with check (is_admin());

create policy "matches: admin update"
  on matches for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "matches: admin delete"
  on matches for delete
  to authenticated
  using (is_admin());


-- ── matchday_squads ───────────────────────────────────────────

alter table matchday_squads enable row level security;

create policy "matchday_squads: public read"
  on matchday_squads for select
  to anon, authenticated
  using (true);

create policy "matchday_squads: admin insert"
  on matchday_squads for insert
  to authenticated
  with check (is_admin());

create policy "matchday_squads: admin update"
  on matchday_squads for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "matchday_squads: admin delete"
  on matchday_squads for delete
  to authenticated
  using (is_admin());


-- ── player_match_scores ───────────────────────────────────────

alter table player_match_scores enable row level security;

create policy "player_match_scores: public read"
  on player_match_scores for select
  to anon, authenticated
  using (true);

create policy "player_match_scores: admin insert"
  on player_match_scores for insert
  to authenticated
  with check (is_admin());

create policy "player_match_scores: admin update"
  on player_match_scores for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "player_match_scores: admin delete"
  on player_match_scores for delete
  to authenticated
  using (is_admin());


-- ── manager_round_squads ──────────────────────────────────────

alter table manager_round_squads enable row level security;

create policy "manager_round_squads: authenticated read"
  on manager_round_squads for select
  to authenticated
  using (true);

-- Manager can create their own draft squad; Edge Function is the enforced path
create policy "manager_round_squads: manager insert own"
  on manager_round_squads for insert
  to authenticated
  with check (profile_id = auth.uid() or is_admin());

-- Manager can update their own squad while it is not locked
create policy "manager_round_squads: manager update own unlocked"
  on manager_round_squads for update
  to authenticated
  using  ((profile_id = auth.uid() and status != 'locked') or is_admin())
  with check (profile_id = auth.uid() or is_admin());

create policy "manager_round_squads: admin delete"
  on manager_round_squads for delete
  to authenticated
  using (is_admin());


-- ── manager_round_squad_players ───────────────────────────────

alter table manager_round_squad_players enable row level security;

create policy "manager_round_squad_players: authenticated read"
  on manager_round_squad_players for select
  to authenticated
  using (true);

-- Manager can add players to their own non-locked squad
create policy "manager_round_squad_players: manager insert own"
  on manager_round_squad_players for insert
  to authenticated
  with check (
    is_admin() or exists (
      select 1 from manager_round_squads mrs
      where mrs.id    = squad_id
        and mrs.profile_id = auth.uid()
        and mrs.status != 'locked'
    )
  );

-- Manager can remove players from their own non-locked squad
create policy "manager_round_squad_players: manager delete own"
  on manager_round_squad_players for delete
  to authenticated
  using (
    is_admin() or exists (
      select 1 from manager_round_squads mrs
      where mrs.id    = squad_id
        and mrs.profile_id = auth.uid()
        and mrs.status != 'locked'
    )
  );

-- Admin can correct role or captain status after submission
create policy "manager_round_squad_players: admin update"
  on manager_round_squad_players for update
  to authenticated
  using  (is_admin())
  with check (is_admin());


-- ── manager_match_scores ──────────────────────────────────────
-- Written by the scoring Edge Function (service role bypasses RLS).
-- No direct client writes.

alter table manager_match_scores enable row level security;

create policy "manager_match_scores: authenticated read"
  on manager_match_scores for select
  to authenticated
  using (true);

create policy "manager_match_scores: admin insert"
  on manager_match_scores for insert
  to authenticated
  with check (is_admin());

create policy "manager_match_scores: admin update"
  on manager_match_scores for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "manager_match_scores: admin delete"
  on manager_match_scores for delete
  to authenticated
  using (is_admin());


-- ── fixture_groups ────────────────────────────────────────────

alter table fixture_groups enable row level security;

create policy "fixture_groups: authenticated read"
  on fixture_groups for select
  to authenticated
  using (true);

create policy "fixture_groups: admin insert"
  on fixture_groups for insert
  to authenticated
  with check (is_admin());

create policy "fixture_groups: admin update"
  on fixture_groups for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "fixture_groups: admin delete"
  on fixture_groups for delete
  to authenticated
  using (is_admin());


-- ── fixture_group_members ─────────────────────────────────────

alter table fixture_group_members enable row level security;

create policy "fixture_group_members: authenticated read"
  on fixture_group_members for select
  to authenticated
  using (true);

create policy "fixture_group_members: admin insert"
  on fixture_group_members for insert
  to authenticated
  with check (is_admin());

create policy "fixture_group_members: admin update"
  on fixture_group_members for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "fixture_group_members: admin delete"
  on fixture_group_members for delete
  to authenticated
  using (is_admin());
