-- ============================================================
-- Study 4: fpl.player_archetypes (APPROVED)
-- Additive. Archetype axis = STABILITY (start_rate); ppg_started is QUALITY,
-- kept deliberately separate — "core" must NEVER imply "good".
-- fixture_sensitivity stays CONTINUOUS (no hard-coded 3rd archetype).
-- ============================================================
create table if not exists fpl.player_archetypes (
  id                  bigint generated always as identity primary key,
  season_id           text   not null references fpl.seasons (id),
  player_id           bigint not null references fpl.players (id),
  archetype           text   not null check (archetype in ('nailed','rotation','fringe')),
  start_rate          numeric(4,3),   -- starts / season GWs (stability axis)
  ppg_started         numeric(5,2),   -- QUALITY, separate from archetype
  minutes_cv          numeric(5,3),   -- minutes consistency among appearances
  fixture_sensitivity numeric(4,3),   -- per-player Spearman(rel-ELO, pts); continuous, noisy
  appearances         int,
  computed_at         timestamptz not null default now(),
  unique (season_id, player_id)
);

alter table fpl.player_archetypes enable row level security;
drop policy if exists "authenticated read" on fpl.player_archetypes;
create policy "authenticated read" on fpl.player_archetypes
  for select to authenticated using (true);

grant select on fpl.player_archetypes to authenticated;
grant select, insert, update, delete on fpl.player_archetypes to service_role;

select 'player_archetypes' as table,
       (select count(*) from information_schema.columns
         where table_schema='fpl' and table_name='player_archetypes') as ncols,
       (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='fpl' and c.relname='player_archetypes') as rls;
