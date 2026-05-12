-- ============================================================
-- SPAL Migration 001 — Foundation
-- Layer 1: seasons, profiles, players, player_prices
--
-- Prerequisites: none (first migration)
-- Run order:  utility functions → tables → security helpers → RLS
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- UTILITY FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- Keeps updated_at current on any row change.
-- Attached as a BEFORE UPDATE trigger on every mutable table.
create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── seasons ──────────────────────────────────────────────────

create table seasons (
  id         bigint      generated always as identity primary key,
  year       int         not null,
  status     text        not null default 'setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint seasons_year_unique unique (year),
  constraint seasons_status_check
    check (status in ('setup', 'historical', 'live', 'complete'))
);

comment on table  seasons        is 'One row per SPAL season, corresponding to one Six Nations tournament.';
comment on column seasons.year   is 'Calendar year, e.g. 2026. Unique — one SPAL season per year.';
comment on column seasons.status is '"setup" = being configured; "historical" = completed past data used for seeding/testing; "live" = active season; "complete" = finalised.';

create trigger seasons_updated_at
  before update on seasons
  for each row execute function update_updated_at_column();


-- ── profiles ─────────────────────────────────────────────────
-- Extends auth.users. One row per user, created automatically
-- by the on_auth_user_created trigger defined in the security
-- section below. Never insert into this table directly.

create table profiles (
  id           uuid        primary key references auth.users(id) on delete cascade,
  email        text        not null,
  display_name text        not null default '',
  team_name    text        not null default '',
  avatar_url   text,
  is_admin     boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  profiles           is 'Public manager profile. One row per auth.users record, created automatically on sign-up.';
comment on column profiles.id        is 'Matches auth.users.id. UUID because it is a foreign key into auth.users — not a generated key.';
comment on column profiles.team_name is 'Manager''s SPAL fantasy team name, set during onboarding.';
comment on column profiles.is_admin  is 'True for the league commissioner / site admin. Grants write access throughout the app. Cannot be self-elevated by a non-admin — enforced by the prevent_admin_self_elevation trigger.';

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at_column();

-- Email lookup used during the invite flow
create index profiles_email_idx on profiles (email);


-- ── players ──────────────────────────────────────────────────
-- Canonical player records per season. Populated via the import
-- pipeline; admin can correct individual fields after import.

create table players (
  id                 bigint      generated always as identity primary key,
  season_id          bigint      not null references seasons(id),
  display_name       text        not null,
  search_name        text        not null,
  nation             text        not null,
  canonical_position text        not null,
  position_group     text        not null,
  active             boolean     not null default true,
  source_id          text,
  raw_profile        jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint players_nation_check
    check (nation in ('England', 'Ireland', 'Scotland', 'Wales', 'France', 'Italy')),
  constraint players_position_group_check
    check (position_group in ('Front Row', 'Back Row', 'Outside Back'))
);

comment on table  players                    is 'Canonical player records for a season. Source of truth for squad and draft validation.';
comment on column players.search_name        is 'Lowercased, accent-stripped version of display_name. Used for import deduplication and name-matching across sources.';
comment on column players.canonical_position is 'Fine-grained position: Prop, Hooker, Second Row, Back Row, Scrum-half, Fly-half, Centre, Outside Back.';
comment on column players.position_group     is 'Coarse draft-slot group used to evaluate draft eligibility: Front Row, Back Row, or Outside Back.';
comment on column players.source_id          is 'Player ID from the external data source (e.g. official fantasy game). Used to match on re-import and detect duplicates.';
comment on column players.raw_profile        is 'Full source record as received from the import adapter. Stored unchanged for audit and debugging.';

create trigger players_updated_at
  before update on players
  for each row execute function update_updated_at_column();

create index players_season_id_idx       on players (season_id);
create index players_nation_idx          on players (nation);
create index players_position_group_idx  on players (position_group);
create index players_search_name_idx     on players (search_name);
-- Partial index for the common "list active players for a season" query
create index players_active_season_idx   on players (season_id) where active = true;

-- Prevent duplicate source IDs within a season on re-import.
-- Partial because source_id is often null (manually-entered players).
create unique index players_source_id_season_unique
  on players (season_id, source_id)
  where source_id is not null;


-- ── player_prices ─────────────────────────────────────────────
-- Price per player per season, with optional per-round snapshots.
-- round_number = NULL  →  season-opening price (baseline)
-- round_number = 1–5   →  snapshot after that round's prices are published

create table player_prices (
  id             bigint        generated always as identity primary key,
  player_id      bigint        not null references players(id),
  season_id      bigint        not null references seasons(id),
  round_number   int,
  source_price   numeric(10,2),
  override_price numeric(10,2),
  -- Generated: override_price takes precedence over source_price.
  -- Used by squad builder for budget validation.
  final_price    numeric(10,2) generated always as (coalesce(override_price, source_price)) stored,
  imported_at    timestamptz   not null default now(),
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),

  constraint player_prices_round_positive
    check (round_number is null or round_number >= 1)
);

-- One price row per player/season/round combination.
-- NULLS NOT DISTINCT (PostgreSQL 15+): two NULL round_numbers are treated
-- as equal, so there can only be one season-opening price per player/season.
create unique index player_prices_unique_idx
  on player_prices (player_id, season_id, round_number)
  nulls not distinct;

comment on table  player_prices                is 'Player prices per season with optional per-round snapshots. final_price is a generated column: override_price if set, otherwise source_price.';
comment on column player_prices.round_number   is 'NULL = season-opening price. 1–5 for round-specific price snapshots (official prices may change between rounds).';
comment on column player_prices.source_price   is 'Price as imported from the official or manual source. Null if no import has run for this round yet.';
comment on column player_prices.override_price is 'Admin correction that supersedes source_price. Override actions are logged in admin_overrides (added in a later migration).';
comment on column player_prices.final_price    is 'Generated column: override_price ?? source_price. The value used for budget validation at squad submission.';
comment on column player_prices.imported_at    is 'When this price was received from the import adapter. Distinct from created_at (row insertion) and updated_at (last modification).';

create trigger player_prices_updated_at
  before update on player_prices
  for each row execute function update_updated_at_column();

create index player_prices_player_id_idx    on player_prices (player_id);
create index player_prices_season_round_idx on player_prices (season_id, round_number);


-- ─────────────────────────────────────────────────────────────
-- SECURITY HELPERS
-- Defined after profiles exists (is_admin queries profiles).
-- ─────────────────────────────────────────────────────────────

-- Returns true if the calling user has is_admin = true in profiles.
-- SECURITY DEFINER: runs as the function owner, bypassing RLS on profiles,
-- so it works even before the calling user's session has been evaluated.
-- Exposes only a boolean — no profile data leaks through this function.
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from profiles where id = auth.uid()),
    false
  )
$$;


-- Prevents any user from changing is_admin on their own (or any) profile
-- unless they are already an admin. Guards against self-elevation even when
-- the self-update RLS policy grants UPDATE access to the row.
create or replace function prevent_admin_self_elevation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_admin is distinct from new.is_admin and not is_admin() then
    raise exception 'Unauthorized: only an existing admin can change is_admin';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_admin_elevation
  before update on profiles
  for each row execute function prevent_admin_self_elevation();


-- Auto-creates a profiles row when a new auth.users record is created.
-- display_name is seeded from sign-up metadata if provided, otherwise
-- from the local part of the email address.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Enable RLS and define policies for all four tables.
-- ─────────────────────────────────────────────────────────────


-- ── seasons ──────────────────────────────────────────────────

alter table seasons enable row level security;

-- Public pages (standings, history, laws) need season data without auth
create policy "seasons: public read"
  on seasons for select
  to anon, authenticated
  using (true);

create policy "seasons: admin insert"
  on seasons for insert
  to authenticated
  with check (is_admin());

create policy "seasons: admin update"
  on seasons for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "seasons: admin delete"
  on seasons for delete
  to authenticated
  using (is_admin());


-- ── profiles ─────────────────────────────────────────────────

alter table profiles enable row level security;

-- Manager names and team names are publicly visible
create policy "profiles: public read"
  on profiles for select
  to anon, authenticated
  using (true);

-- Managers can update their own display_name, team_name, avatar_url.
-- They cannot elevate is_admin — blocked by prevent_admin_self_elevation trigger.
create policy "profiles: self update"
  on profiles for update
  to authenticated
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- Admin can update any profile (e.g. set is_admin, correct display names)
create policy "profiles: admin update"
  on profiles for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

-- INSERT is handled exclusively by the handle_new_user trigger (SECURITY DEFINER).
-- No direct-insert policy — prevents clients from inserting arbitrary profile rows.

create policy "profiles: admin delete"
  on profiles for delete
  to authenticated
  using (is_admin());


-- ── players ──────────────────────────────────────────────────

alter table players enable row level security;

-- Public player list page requires anon read access
create policy "players: public read"
  on players for select
  to anon, authenticated
  using (true);

create policy "players: admin insert"
  on players for insert
  to authenticated
  with check (is_admin());

create policy "players: admin update"
  on players for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "players: admin delete"
  on players for delete
  to authenticated
  using (is_admin());


-- ── player_prices ─────────────────────────────────────────────

alter table player_prices enable row level security;

-- Prices are shown on the public player list and squad builder
create policy "player_prices: public read"
  on player_prices for select
  to anon, authenticated
  using (true);

create policy "player_prices: admin insert"
  on player_prices for insert
  to authenticated
  with check (is_admin());

create policy "player_prices: admin update"
  on player_prices for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "player_prices: admin delete"
  on player_prices for delete
  to authenticated
  using (is_admin());
