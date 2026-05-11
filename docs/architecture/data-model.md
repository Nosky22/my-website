# SPAL Data Model

This document describes the intended database schema. Detailed SQL migrations are developed separately.

All tables use `uuid` primary keys and `timestamptz` for timestamps. All timestamps stored in UTC.

---

## Identity

### `profiles`
Extends Supabase auth users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | matches `auth.users.id` |
| `email` | text | from auth |
| `display_name` | text | shown in UI |
| `team_name` | text | manager's fantasy team name |
| `avatar_url` | text | optional |
| `created_at` | timestamptz | |

### `user_roles`
One row per user per role. Roles: `admin`, `manager`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `profile_id` | uuid FK → profiles | |
| `role` | text | `admin` or `manager` |
| `created_at` | timestamptz | |

---

## Seasons and leagues

### `seasons`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `year` | int | e.g. 2026, 2027 |
| `status` | text | `setup`, `historical`, `live`, `complete` |
| `created_at` | timestamptz | |

### `season_rules`
Stores the full ruleset JSON for a season.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `season_id` | uuid FK → seasons | |
| `rules` | jsonb | full configurable ruleset |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `leagues`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `season_id` | uuid FK → seasons | |
| `name` | text | |
| `status` | text | `setup`, `draft`, `live`, `complete` |
| `commissioner_id` | uuid FK → profiles | |
| `created_at` | timestamptz | |

### `league_members`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `profile_id` | uuid FK → profiles | |
| `previous_year_rank` | int | used to generate draft order |
| `draft_position` | int | assigned by admin |
| `joined_at` | timestamptz | |

### `league_guest_links`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `token_hash` | text | hashed opaque token; raw token never stored |
| `created_by` | uuid FK → profiles | |
| `expires_at` | timestamptz | nullable |
| `revoked_at` | timestamptz | nullable |
| `created_at` | timestamptz | |

---

## Data sources and imports

### `data_sources`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | e.g. `officialFantasyAdapter` |
| `type` | text | `api`, `csv`, `manual`, `legacy` |
| `config` | jsonb | adapter-specific config |
| `active` | boolean | |

### `import_runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source_id` | uuid FK → data_sources | |
| `season_id` | uuid FK → seasons | |
| `status` | text | `pending`, `running`, `complete`, `failed` |
| `records_created` | int | |
| `records_updated` | int | |
| `records_flagged` | int | |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `run_by` | uuid FK → profiles | |

### `raw_import_payloads`
Stores original source data unchanged.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `import_run_id` | uuid FK → import_runs | |
| `payload` | jsonb | raw source data |
| `created_at` | timestamptz | |

### `data_quality_issues`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `import_run_id` | uuid FK → import_runs | |
| `issue_code` | text | e.g. `PLAYER_NAME_AMBIGUOUS` |
| `description` | text | |
| `raw_data` | jsonb | the offending source record |
| `resolved` | boolean | |
| `resolved_by` | uuid FK → profiles | |
| `resolved_at` | timestamptz | |

---

## Players and prices

### `players`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `season_id` | uuid FK → seasons | |
| `display_name` | text | |
| `search_name` | text | lowercased, normalised for matching |
| `nation` | text | England, Ireland, Scotland, Wales, France, Italy |
| `canonical_position` | text | e.g. `Prop`, `Hooker`, `Back Row` |
| `position_group` | text | e.g. `Front Row`, `Back Row`, `Outside Back` |
| `active` | boolean | |
| `source_id` | text | external ID from source where available |
| `raw_profile` | jsonb | full source record |
| `created_at` | timestamptz | |

### `player_prices`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `player_id` | uuid FK → players | |
| `season_id` | uuid FK → seasons | |
| `round_number` | int | nullable for season-opening price |
| `source_price` | numeric | imported price |
| `override_price` | numeric | admin-set override, nullable |
| `final_price` | numeric | generated: `override_price ?? source_price` |
| `imported_at` | timestamptz | |

---

## Fixtures and match data

### `matches`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `season_id` | uuid FK → seasons | |
| `round_number` | int | |
| `home_nation` | text | |
| `away_nation` | text | |
| `kickoff_at` | timestamptz | UTC |
| `status` | text | `scheduled`, `live`, `complete` |

### `matchday_squads`
Player status per match (starting, bench, not selected).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `player_id` | uuid FK → players | |
| `shirt_number` | int | nullable |
| `status` | text | `starting`, `bench`, `not_selected`, `unknown` |
| `source` | text | which adapter provided this |
| `imported_at` | timestamptz | |

### `player_match_scores`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `player_id` | uuid FK → players | |
| `season_id` | uuid FK → seasons | |
| `source_points` | numeric | imported |
| `admin_override_points` | numeric | nullable |
| `final_points` | numeric | generated: `admin_override_points ?? source_points` |
| `status` | text | `provisional`, `final`, `corrected` |
| `imported_at` | timestamptz | |

---

## Draft

### `drafts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `season_id` | uuid FK → seasons | |
| `status` | text | `scheduled`, `live`, `paused`, `complete` |
| `current_pick_number` | int | |
| `pick_timer_seconds` | int | default 120 |
| `started_at` | timestamptz | |
| `completed_at` | timestamptz | |

### `draft_slots`
Defines the required draft slots per league (e.g. Front Row, Back Row, Outside Back, Wales).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `slot_number` | int | order within the draft |
| `slot_type` | text | `position_group`, `nation`, `bench_eligible` |
| `requirement` | text | e.g. `Front Row`, `Wales`, `bench_eligible` |
| `required` | boolean | false for optional 5th slot |

### `draft_picks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `draft_id` | uuid FK → drafts | |
| `league_member_id` | uuid FK → league_members | |
| `player_id` | uuid FK → players | |
| `draft_slot_id` | uuid FK → draft_slots | slot this pick satisfies |
| `pick_number` | int | sequential within draft |
| `created_at` | timestamptz | |

---

## Squads

### `manager_round_squads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `league_member_id` | uuid FK → league_members | |
| `season_id` | uuid FK → seasons | |
| `round_number` | int | |
| `status` | text | `draft`, `submitted`, `locked` |
| `submitted_at` | timestamptz | |
| `locked_at` | timestamptz | |

### `manager_round_squad_players`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `squad_id` | uuid FK → manager_round_squads | |
| `player_id` | uuid FK → players | |
| `role` | text | `starter`, `supersub` |
| `is_captain` | boolean | |

---

## Scoring and standings

### `manager_match_scores`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `squad_id` | uuid FK → manager_round_squads | |
| `match_id` | uuid FK → matches | |
| `league_member_id` | uuid FK → league_members | |
| `raw_points` | numeric | before multipliers |
| `adjusted_points` | numeric | after captain/supersub multipliers |
| `final_points` | numeric | after penalties |
| `status` | text | `provisional`, `final` |

### `fixture_groups`
Represents one pair or triple H2H fixture for a round.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `round_number` | int | |
| `fixture_type` | text | `pair` or `triple` |
| `status` | text | `scheduled`, `complete` |

### `fixture_group_members`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `fixture_group_id` | uuid FK → fixture_groups | |
| `league_member_id` | uuid FK → league_members | |
| `round_points` | numeric | manager's total for the round |
| `placing` | int | 1st, 2nd, or 3rd within the group |
| `h2h_points` | int | H2H league points awarded |

### `league_standings`

Materialised or computed view of current H2H and total-points standings per league per round.

---

## Chronicle, history, penalties

### `league_posts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `season_id` | uuid FK → seasons | |
| `round_number` | int | nullable |
| `post_type` | text | `weekly_preview`, `weekly_results`, `draft_recap`, `penalty_notice`, `season_review`, `historic_article`, `admin_note` |
| `title` | text | |
| `slug` | text | URL slug |
| `body_md` | text | Markdown content |
| `visibility` | text | `manager`, `guest`, `public` |
| `author_id` | uuid FK → profiles | |
| `published_at` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `league_penalties`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `season_id` | uuid FK → seasons | |
| `round_number` | int | |
| `league_member_id` | uuid FK → league_members | |
| `penalty_type` | text | |
| `description` | text | |
| `points_adjustment` | numeric | nullable |
| `created_by` | uuid FK → profiles | |
| `created_at` | timestamptz | |

---

## Admin and audit

### `admin_overrides`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | nullable (some overrides are season-level) |
| `season_id` | uuid FK → seasons | |
| `entity_type` | text | e.g. `player`, `score`, `price`, `squad` |
| `entity_id` | uuid | the record being overridden |
| `field_name` | text | the field changed |
| `old_value` | jsonb | |
| `new_value` | jsonb | |
| `reason` | text | required |
| `created_by` | uuid FK → profiles | |
| `created_at` | timestamptz | |

### `audit_log`
Append-only log of significant admin actions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `actor_id` | uuid FK → profiles | |
| `action` | text | e.g. `draft.pick_undone`, `round.finalised` |
| `entity_type` | text | |
| `entity_id` | uuid | |
| `metadata` | jsonb | |
| `created_at` | timestamptz | |

---

## Legacy import staging

### `legacy_import_files`
### `legacy_import_sheets`
### `legacy_import_rows`
### `legacy_import_issues`

Used during Phase 1 to stage the 2026 spreadsheet data for admin review. Structure mirrors `import_runs` and `data_quality_issues` but is separated to avoid polluting canonical import history.

---

## Notifications

### `notifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `profile_id` | uuid FK → profiles | |
| `type` | text | e.g. `draft.on_clock`, `round.finalised` |
| `title` | text | |
| `body` | text | |
| `read` | boolean | |
| `created_at` | timestamptz | |

### `email_events`
Log of sent emails for debugging and audit.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `profile_id` | uuid FK → profiles | nullable for invite emails |
| `email_type` | text | |
| `provider_message_id` | text | |
| `sent_at` | timestamptz | |
| `status` | text | `sent`, `failed`, `bounced` |
