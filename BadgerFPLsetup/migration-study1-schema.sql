-- ============================================================
-- Study 1 schema additions (APPROVED)
-- Additive only, no data loss:
--   fpl.teams.code            — persistent cross-season team identity (ELO linker)
--   fpl.seasons.crowd_conditions — 'normal' | 'behind_closed_doors' (COVID/HFA flag)
-- ============================================================

-- 1. teams.code (nullable now; backfilled from raw caches, then SET NOT NULL)
alter table fpl.teams add column if not exists code integer;

-- 2. seasons.crowd_conditions (minimal two-label flag)
alter table fpl.seasons add column if not exists crowd_conditions text;
update fpl.seasons set crowd_conditions = 'normal' where crowd_conditions is null;
update fpl.seasons set crowd_conditions = 'behind_closed_doors' where id = '2020-21';
alter table fpl.seasons
  drop constraint if exists seasons_crowd_conditions_check;
alter table fpl.seasons
  add constraint seasons_crowd_conditions_check
  check (crowd_conditions in ('normal','behind_closed_doors'));
alter table fpl.seasons alter column crowd_conditions set not null;

-- verify
select id, data_tier, crowd_conditions from fpl.seasons order by id;
