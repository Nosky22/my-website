-- ============================================================
-- SPAL Migration 002 — Draft tables
-- draft_order, draft_sessions, draft_picks
--
-- Prerequisites: 001_foundation.sql (seasons, profiles, players)
-- Additive only — no existing tables altered or dropped
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── draft_order ───────────────────────────────────────────────
-- Defines which manager picks at which position in a given season.
-- Set by admin before the draft begins. Reverse standings order
-- from the previous year per the rules.

create table draft_order (
  id            bigint      generated always as identity primary key,
  season_id     bigint      not null references seasons(id),
  profile_id    uuid        not null references profiles(id),
  pick_position int         not null,
  created_at    timestamptz not null default now(),

  -- Each pick position is held by exactly one manager per season
  constraint draft_order_position_unique unique (season_id, pick_position),
  -- Each manager has exactly one pick position per season
  constraint draft_order_manager_unique  unique (season_id, profile_id),
  constraint draft_order_position_positive check (pick_position >= 1)
);

comment on table  draft_order               is 'Pick order for each manager in a season. Set by admin before the draft; reverse standings order from the prior year.';
comment on column draft_order.pick_position is 'The position in the draft order (1 = picks first). Must be unique per season.';

create index draft_order_season_id_idx  on draft_order (season_id);
create index draft_order_profile_id_idx on draft_order (profile_id);


-- ── draft_sessions ─────────────────────────────────────────────
-- The live draft event for a season. One session per season.
-- Tracks current state for the real-time draft room.

create table draft_sessions (
  id                  bigint      generated always as identity primary key,
  season_id           bigint      not null references seasons(id),
  status              text        not null default 'pending',
  current_pick_number int         not null default 1,
  pick_timer_seconds  int         not null default 120,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Exactly one draft session per season
  constraint draft_sessions_season_unique unique (season_id),
  constraint draft_sessions_status_check
    check (status in ('pending', 'active', 'paused', 'complete')),
  constraint draft_sessions_pick_number_positive check (current_pick_number >= 1),
  constraint draft_sessions_timer_positive       check (pick_timer_seconds  >= 1)
);

comment on table  draft_sessions                     is 'The live draft event for a season. One row per season; drives the real-time draft room state.';
comment on column draft_sessions.status              is 'pending | active | paused | complete.';
comment on column draft_sessions.current_pick_number is 'The overall pick number currently on the clock. Increments after each pick is recorded.';
comment on column draft_sessions.pick_timer_seconds  is 'Seconds allowed per pick. Default 120 (2 minutes) per the rules; admin can adjust before the draft starts.';
comment on column draft_sessions.started_at          is 'Set when admin moves status to active.';
comment on column draft_sessions.completed_at        is 'Set when all picks are made and status moves to complete.';

create trigger draft_sessions_updated_at
  before update on draft_sessions
  for each row execute function update_updated_at_column();

create index draft_sessions_season_id_idx on draft_sessions (season_id);


-- ── draft_picks ────────────────────────────────────────────────
-- Each individual pick made during the draft.
-- Picks are written by Edge Functions (service role), not directly
-- by the browser. The manager-insert RLS policy below exists for
-- completeness; the Edge Function path is the enforced one.

create table draft_picks (
  id           bigint      generated always as identity primary key,
  season_id    bigint      not null references seasons(id),
  profile_id   uuid        not null references profiles(id),
  player_id    bigint      not null references players(id),
  pick_number  int         not null,
  draft_slot   text        not null,
  picked_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),

  -- A player can only be drafted once per season (exclusivity rule)
  constraint draft_picks_player_unique unique (season_id, player_id),
  -- A manager can only fill each draft slot once per season
  constraint draft_picks_slot_unique   unique (season_id, profile_id, draft_slot),
  constraint draft_picks_pick_number_positive check (pick_number >= 1),
  constraint draft_picks_draft_slot_check
    check (draft_slot in ('Front Row', 'Back Row', 'Outside Back', 'Wales', 'Bench Sub'))
);

comment on table  draft_picks            is 'Individual picks made during the draft. Written via Edge Function; each player is exclusive to one manager per season.';
comment on column draft_picks.pick_number is 'Sequential pick number across the whole draft (not per-manager). Used to reconstruct draft order.';
comment on column draft_picks.draft_slot  is 'The slot this pick satisfies: Front Row, Back Row, Outside Back, Wales, or Bench Sub (optional 5th slot).';
comment on column draft_picks.picked_at   is 'When the pick was made. Distinct from created_at; picked_at is the game-meaningful timestamp.';

create index draft_picks_season_id_idx   on draft_picks (season_id);
create index draft_picks_profile_id_idx  on draft_picks (profile_id);
create index draft_picks_player_id_idx   on draft_picks (player_id);
-- Supports "show all picks for a season in order" — the primary draft board query
create index draft_picks_season_order_idx on draft_picks (season_id, pick_number);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────


-- ── draft_order ───────────────────────────────────────────────

alter table draft_order enable row level security;

create policy "draft_order: authenticated read"
  on draft_order for select
  to authenticated
  using (true);

create policy "draft_order: admin insert"
  on draft_order for insert
  to authenticated
  with check (is_admin());

create policy "draft_order: admin update"
  on draft_order for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "draft_order: admin delete"
  on draft_order for delete
  to authenticated
  using (is_admin());


-- ── draft_sessions ─────────────────────────────────────────────

alter table draft_sessions enable row level security;

create policy "draft_sessions: authenticated read"
  on draft_sessions for select
  to authenticated
  using (true);

create policy "draft_sessions: admin insert"
  on draft_sessions for insert
  to authenticated
  with check (is_admin());

create policy "draft_sessions: admin update"
  on draft_sessions for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "draft_sessions: admin delete"
  on draft_sessions for delete
  to authenticated
  using (is_admin());


-- ── draft_picks ────────────────────────────────────────────────

alter table draft_picks enable row level security;

create policy "draft_picks: authenticated read"
  on draft_picks for select
  to authenticated
  using (true);

-- Edge Functions (service role) bypass RLS entirely, so picks made
-- through the normal draft flow are covered. This policy allows the
-- picking manager to insert their own pick as a fallback, but the
-- Edge Function is the intended and enforced write path.
create policy "draft_picks: manager insert own"
  on draft_picks for insert
  to authenticated
  with check (profile_id = auth.uid() or is_admin());

-- Only admin can correct picks after the fact
create policy "draft_picks: admin update"
  on draft_picks for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "draft_picks: admin delete"
  on draft_picks for delete
  to authenticated
  using (is_admin());
