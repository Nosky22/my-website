-- ============================================================
-- Migration: elite-manager action capture (2025/26 cohort)
-- Additive only — no data loss. manager_picks is empty, so ADD COLUMN
-- affects zero rows. Reverse would be DROP TABLE / DROP COLUMN.
-- ============================================================

-- 1. manager_picks: preserve bench slot order (1-15) — irreplaceable one-shot data
alter table fpl.manager_picks add column if not exists position smallint;

-- 2. Per manager per GW: chip + aggregates + rank ("chip played that GW" lives here)
create table if not exists fpl.manager_gameweeks (
  id               bigint generated always as identity primary key,
  season_id        text not null references fpl.seasons (id),
  manager_entry_id bigint not null,
  gw_number        int not null,
  points           int,
  total_points     int,
  overall_rank     bigint,
  gw_rank          bigint,
  bank             numeric(5,1),
  team_value       numeric(5,1),
  event_transfers      int,
  event_transfers_cost int,
  points_on_bench  int,
  chip             text,   -- 'wildcard','bboost','3xc','freehit', null
  captured_at      timestamptz not null default now(),
  unique (season_id, manager_entry_id, gw_number)
);

-- 3. Full transfer history
create table if not exists fpl.manager_transfers (
  id               bigint generated always as identity primary key,
  season_id        text not null references fpl.seasons (id),
  manager_entry_id bigint not null,
  gw_number        int not null,   -- 'event' the transfer was made for
  player_in_id     bigint references fpl.players (id),
  player_out_id    bigint references fpl.players (id),
  player_in_cost   numeric(5,1),
  player_out_cost  numeric(5,1),
  transfer_time    timestamptz,
  unique (season_id, manager_entry_id, gw_number, player_in_id, player_out_id)
);

-- 4. Past-season summaries (consistently-elite filter). season_name is NOT an
-- fpl.seasons FK — it can include seasons we don't model (e.g. 2015/16).
create table if not exists fpl.manager_seasons (
  id               bigint generated always as identity primary key,
  manager_entry_id bigint not null,
  season_name      text not null,
  total_points     int,
  overall_rank     bigint,
  captured_at      timestamptz not null default now(),
  unique (manager_entry_id, season_name)
);

-- ------------------------------------------------------------
-- RLS: shared (non-personal) analysis data → authenticated read.
-- Writes happen only via the service role (bypasses RLS).
-- ------------------------------------------------------------
alter table fpl.manager_gameweeks enable row level security;
alter table fpl.manager_transfers enable row level security;
alter table fpl.manager_seasons   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'manager_gameweeks','manager_transfers','manager_seasons'
  ] loop
    execute format('drop policy if exists "authenticated read" on fpl.%I;', t);
    execute format(
      'create policy "authenticated read" on fpl.%I
         for select to authenticated using (true);', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- Grants (mirror manager_picks: authenticated select + service_role full)
-- ------------------------------------------------------------
grant select on fpl.manager_gameweeks, fpl.manager_transfers, fpl.manager_seasons
  to authenticated;
grant select, insert, update, delete
  on fpl.manager_gameweeks, fpl.manager_transfers, fpl.manager_seasons
  to service_role;
