# SPAL Scoring Engine

---

## Principle

Scoring is deterministic and testable. Given the same squad, player scores, and ruleset, the engine always produces the same result. All configurable values come from the season ruleset, never from hard-coded constants.

---

## Player score model

For each player in each match:

```
source_points           — imported from official feed or manual input
admin_override_points   — set by admin if correction needed (nullable)
final_points            = admin_override_points ?? source_points
status                  = provisional | final | corrected
```

`provisional` — scores imported but round not yet finalised  
`final` — admin has finalised the round  
`corrected` — score was changed after finalisation (triggers recalculation)

---

## Manager round score model

For each player in a manager's submitted squad:

| Role | Points applied |
|------|---------------|
| Regular starter | `final_points` |
| Captain | `final_points × captain_multiplier` |
| Supersub (comes off real-life bench) | `final_points × supersub_bench_multiplier` |
| Supersub (starts in real life) | `final_points × supersub_starter_multiplier` |
| Supersub (does not play) | `supersub_not_played_points` |

Then subtract any admin-applied penalties for the round.

### Default multiplier values (confirmed, configurable per season)

```json
{
  "captain_multiplier": 2,
  "supersub_bench_multiplier": 3,
  "supersub_starter_multiplier": 0.5,
  "supersub_not_played_points": 0
}
```

Note: `supersub_starter_multiplier` of 0.5 is drawn from the legacy 2026 spreadsheet. Confirm against 2027 official rules before the live season.

### Supersub real-life status determination

Supersub status is determined from `matchday_squads`:
- Shirt number 1–15: `starting` → apply `supersub_starter_multiplier`
- Shirt number 16–23: `bench` → apply `supersub_bench_multiplier`
- Not in matchday squad: `not_selected` → apply `supersub_not_played_points`
- Status `unknown`: flag for admin review; scoring is blocked for this player until resolved

---

## H2H scoring

### Pair fixture

```
Higher score  → 4 H2H league points
Lower score   → 0 H2H league points
Draw          → 2 H2H league points each
```

### Triple fixture

```
1st (highest) → 4 H2H league points
2nd           → 2 H2H league points
3rd (lowest)  → 0 H2H league points
```

### Triple tie handling (configurable)

| Situation | Points awarded |
|-----------|----------------|
| Two managers tie for 1st | Both receive 3; third receives 0 |
| Two managers tie for 2nd | 1st receives 4; tied managers receive 1 each |
| All three tie | All receive 2 |

Tie handling rules are configurable via season ruleset.

---

## Fixture generation

For a 7-manager league across 5 gameweeks (Six Nations):

```
Each gameweek: 3 pair fixtures + 1 triple fixture
Total: 15 pair fixtures + 5 triple fixtures = 20 fixtures
```

Generator constraints (in priority order):
1. One triple fixture per gameweek
2. Every manager appears in at least one triple fixture
3. Triple participation balanced as evenly as possible
4. Avoid repeat triple combinations
5. Avoid repeat pair pairings

Admin can override any generated fixture.

The generator uses `fixture_groups` and `fixture_group_members` tables, not hard-coded home/away pairs. This supports both pairs and triples without schema changes.

---

## Score recalculation triggers

Scoring recalculates automatically when:

- A player score import changes
- An admin overrides a player score
- A Supersub's matchday status changes
- An admin changes a rule value
- A penalty is added, changed, or removed
- A squad is corrected by admin

Recalculation is scoped: only affected rounds and managers are recalculated, not the entire season.

---

## Round finalisation

Before a round can be finalised:

1. All player scores for the round must be imported or manually entered
2. All `unknown` Supersub statuses must be resolved
3. No blocking `data_quality_issues` remain unresolved
4. Admin confirms finalisation

On finalisation:
- All `manager_match_scores` for the round are marked `final`
- `fixture_group_members` H2H points are calculated and written
- `league_standings` is recalculated
- Managers are notified
- Finalisation is recorded in `audit_log`

A round can be re-opened by admin (e.g. to apply a score correction). All affected scores revert to `corrected` status and recalculate.

---

## Decimal handling

Scores preserve decimals internally. Do not round intermediate values.

Display format is configurable per season:
- `1_decimal` — always show one decimal place (e.g. 24.5)
- `smart` — whole number if no decimal, one decimal if fractional (e.g. 24 or 24.5)

---

## Testing

The scoring engine must have comprehensive unit tests. Each test case specifies:
- Input: squad with roles, player final_points, season ruleset
- Expected output: manager round score

Required test cases:
- Regular starter
- Captain
- Supersub from real-life bench
- Supersub starts in real life
- Supersub does not play
- Negative player points
- Admin score override applied
- Admin score override with captain
- Penalty applied
- All three triple fixture positions
- Triple tie scenarios (all three tie variations)

See `docs/development/` for testing approach.
