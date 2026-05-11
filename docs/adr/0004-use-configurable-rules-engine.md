# ADR 0004 — Store game rules as configurable data per season

**Status:** Accepted  
**Date:** 2026-05-10

---

## Context

SPAL has a set of game rules that govern draft eligibility, squad composition, scoring multipliers, nation limits, and H2H points. These rules:

- Change between seasons (official game updates prices, position counts, and scoring rules)
- May differ by league within a season
- Have open questions that will not be resolved before the first live season
- Include SPAL-specific rules (Italian starter, weakest nation, triple fixtures) that may be adjusted by the commissioner

Two approaches:
1. **Hard-code rules** — simpler to implement, but any rule change requires a code change and redeploy
2. **Rules as data** — rules stored as JSON per season in `season_rules`; code reads and applies them at runtime

---

## Decision

Store game rules as a JSON ruleset per season in the `season_rules` table. Code reads the ruleset and applies it; constants are not hard-coded except for the most locked, invariant rules (e.g. 15 starters + 1 Supersub).

Key configurable values:

```json
{
  "budget_limit": 200,
  "budget_enabled": true,
  "max_players_per_nation": 4,
  "captain_multiplier": 2,
  "supersub_bench_multiplier": 3,
  "supersub_starter_multiplier": 0.5,
  "supersub_not_played_points": 0,
  "italian_starter_rule": {
    "enabled": true,
    "required_starters": 1,
    "nation": "Italy",
    "excluded_positions": []
  },
  "weakest_nation": "Wales",
  "draft_slots": [...],
  "position_requirements": [...],
  "h2h_win_points": 4,
  "h2h_draw_points": 2,
  "h2h_loss_points": 0,
  "triple_first_points": 4,
  "triple_second_points": 2,
  "triple_third_points": 0,
  "triple_tie_handling": "standard",
  "pick_timer_seconds": 120,
  "squad_lock_rule": "first_kickoff"
}
```

---

## Consequences

**Positive:**
- Rule changes (e.g. updating the weakest nation, adjusting the Supersub multiplier) are data changes, not code changes
- The 2027 live season can use different rules from the 2026 historical prototype without branching the codebase
- Open questions (Supersub starter multiplier, Italian starter exclusions) can be resolved as data without code changes
- Admin can inspect and understand the current season's rules in the UI

**Negative / constraints:**
- The code must correctly handle every combination of rule values — more paths to test
- Invalid or inconsistent rule JSON can break scoring or validation; the ruleset schema must be validated on write
- Truly invariant rules (15 starters, 1 Supersub, 1 Captain) are still appropriate to enforce in code, not only in data — the data approach is for configurable values, not for overriding fundamental game structure

**Constraint this decision imposes:**
- When adding a new configurable rule, add it to the `season_rules` JSON schema and update `docs/product/rules.md`
- All scoring and validation functions must accept a ruleset parameter — they must not read from environment variables or hard-coded constants
- Unit tests for scoring and validation must parameterise the ruleset so edge cases can be tested with modified values
