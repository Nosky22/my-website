-- ============================================================
-- SPAL Migration 006 — Rules, admin overrides, penalties, audit
-- season_rules, admin_overrides, audit_log, league_penalties
--
-- Prerequisites: 001_foundation.sql (seasons, profiles)
-- Additive only — no existing tables altered or dropped
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLES, TRIGGERS, AND INDEXES
-- ─────────────────────────────────────────────────────────────


-- ── season_rules ──────────────────────────────────────────────
-- One row per season. The JSON ruleset that all scoring and
-- validation code reads at runtime — captain multiplier, Supersub
-- multipliers, budget, nation limits, Italian starter rule, etc.
-- season_id is the primary key: the one-per-season invariant is
-- the whole point, and it eliminates a join on every rules lookup.

create table season_rules (
  season_id  bigint      primary key references seasons(id),
  rules      jsonb       not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table  season_rules       is 'One row per season. The full configurable ruleset (multipliers, budget, nation limits, Italian starter rule, etc.) read by the scoring engine and squad validator at runtime.';
comment on column season_rules.rules is 'Full ruleset JSON. See ADR 0004 and docs/product/rules.md for the expected shape.';

create trigger season_rules_updated_at
  before update on season_rules
  for each row execute function update_updated_at_column();


-- ── admin_overrides ───────────────────────────────────────────
-- Append-only audit trail for every admin data correction.
-- Required by the CLAUDE.md non-negotiable: all overrides must
-- record reason, old value, and new value.
--
-- entity_id is text (not bigint) so it can hold both bigint PKs
-- and uuid PKs (e.g. profiles.id) without casting. No FK is
-- declared — audit rows must survive deletion of the thing they
-- reference.
--
-- No update or delete RLS policies: this table is insert-only
-- by design. A corrected override gets a new row; old rows stand.

create table admin_overrides (
  id          bigint      generated always as identity primary key,
  season_id   bigint      not null references seasons(id),
  entity_type text        not null,
  entity_id   text        not null,
  field_name  text        not null,
  old_value   jsonb,
  new_value   jsonb,
  reason      text        not null,
  created_by  uuid        not null references profiles(id),
  created_at  timestamptz not null default now()
);

comment on table  admin_overrides            is 'Append-only audit trail for admin data corrections. Required for every override. Never updated or deleted — corrections create a new row.';
comment on column admin_overrides.entity_type is 'The type of record overridden, e.g. player_score, player_price, squad, draft_pick.';
comment on column admin_overrides.entity_id   is 'ID of the overridden row as text. Text rather than bigint to handle both bigint and uuid primary keys.';
comment on column admin_overrides.field_name  is 'The column that was changed.';
comment on column admin_overrides.old_value   is 'Previous value as JSON. Null if the field was previously unset.';
comment on column admin_overrides.new_value   is 'Replacement value as JSON.';
comment on column admin_overrides.reason      is 'Required justification. No override is valid without one.';

create index admin_overrides_season_id_idx    on admin_overrides (season_id);
create index admin_overrides_entity_idx       on admin_overrides (entity_type, entity_id);
create index admin_overrides_created_by_idx   on admin_overrides (created_by);


-- ── audit_log ─────────────────────────────────────────────────
-- Append-only log of significant admin actions: round finalisation,
-- re-opening, draft interventions, penalty changes, etc.
-- Referenced in the scoring engine's round finalisation flow.
--
-- entity_id is text for the same reason as admin_overrides.
-- No update or delete RLS policies.

create table audit_log (
  id          bigint      generated always as identity primary key,
  actor_id    uuid        not null references profiles(id),
  action      text        not null,
  entity_type text,
  entity_id   text,
  season_id   bigint      references seasons(id),
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

comment on table  audit_log            is 'Append-only log of significant admin actions. Never updated or deleted.';
comment on column audit_log.action      is 'Machine-readable action identifier, e.g. round.finalised, round.reopened, draft.pick_undone, penalty.added.';
comment on column audit_log.entity_type is 'The type of record acted on, e.g. round, draft_pick, squad, penalty.';
comment on column audit_log.entity_id   is 'ID of the affected row as text. Nullable for season-level or non-row actions.';
comment on column audit_log.season_id   is 'Season context for this action. Nullable for actions not scoped to a season.';
comment on column audit_log.metadata    is 'Any additional context needed to understand the action.';

create index audit_log_actor_id_idx   on audit_log (actor_id);
create index audit_log_season_id_idx  on audit_log (season_id);
create index audit_log_action_idx     on audit_log (action);
create index audit_log_created_at_idx on audit_log (created_at);


-- ── league_penalties ─────────────────────────────────────────
-- Admin-applied point adjustments that feed into
-- manager_match_scores.final_points for a specific round.
-- Negative points_adjustment = deduction; positive = bonus.
-- The scoring engine reads this table when (re)calculating
-- a manager's final score for a round.

create table league_penalties (
  id                bigint        generated always as identity primary key,
  season_id         bigint        not null references seasons(id),
  profile_id        uuid          not null references profiles(id),
  round_number      int           not null,
  penalty_type      text          not null,
  description       text          not null,
  points_adjustment numeric(8,2)  not null,
  created_by        uuid          not null references profiles(id),
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),

  constraint league_penalties_round_positive check (round_number >= 1)
);

comment on table  league_penalties                   is 'Admin-applied point adjustments per manager per round. Negative = deduction; positive = bonus. Read by the scoring engine when calculating final_points.';
comment on column league_penalties.penalty_type       is 'e.g. late_submission, rules_breach, admin_correction.';
comment on column league_penalties.description        is 'Required human-readable explanation of the penalty.';
comment on column league_penalties.points_adjustment  is 'Points added to or subtracted from the manager''s round score. Negative for deductions.';

create trigger league_penalties_updated_at
  before update on league_penalties
  for each row execute function update_updated_at_column();

create index league_penalties_season_id_idx         on league_penalties (season_id);
create index league_penalties_profile_id_idx        on league_penalties (profile_id);
create index league_penalties_season_round_idx      on league_penalties (season_id, round_number);


-- ─────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────


-- ── season_rules ──────────────────────────────────────────────
-- Public read: the Laws page displays configurable rule values.

alter table season_rules enable row level security;

create policy "season_rules: public read"
  on season_rules for select
  to anon, authenticated
  using (true);

create policy "season_rules: admin insert"
  on season_rules for insert
  to authenticated
  with check (is_admin());

create policy "season_rules: admin update"
  on season_rules for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "season_rules: admin delete"
  on season_rules for delete
  to authenticated
  using (is_admin());


-- ── admin_overrides ───────────────────────────────────────────
-- Authenticated read only (override history is league-private).
-- Insert: admin only. No update or delete — insert-only by design.

alter table admin_overrides enable row level security;

create policy "admin_overrides: authenticated read"
  on admin_overrides for select
  to authenticated
  using (true);

create policy "admin_overrides: admin insert"
  on admin_overrides for insert
  to authenticated
  with check (is_admin());


-- ── audit_log ─────────────────────────────────────────────────
-- Authenticated read only. Insert: admin only.
-- No update or delete — insert-only by design.

alter table audit_log enable row level security;

create policy "audit_log: authenticated read"
  on audit_log for select
  to authenticated
  using (true);

create policy "audit_log: admin insert"
  on audit_log for insert
  to authenticated
  with check (is_admin());


-- ── league_penalties ──────────────────────────────────────────

alter table league_penalties enable row level security;

create policy "league_penalties: authenticated read"
  on league_penalties for select
  to authenticated
  using (true);

create policy "league_penalties: admin insert"
  on league_penalties for insert
  to authenticated
  with check (is_admin());

create policy "league_penalties: admin update"
  on league_penalties for update
  to authenticated
  using  (is_admin())
  with check (is_admin());

create policy "league_penalties: admin delete"
  on league_penalties for delete
  to authenticated
  using (is_admin());
