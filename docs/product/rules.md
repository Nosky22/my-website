# SPAL Game Rules

All rules are configurable by season unless marked **locked**. Configurable rules are stored as data (JSON ruleset per season), not hard-coded.

---

## 1. Draft rules

### 1.1 Format
- Draft type: **linear** (locked)
- Draft order: reverse order of previous year's standings
- Draft order is input and controlled by the admin

### 1.2 Draft slots

Each manager drafts **4 required slots** (a 5th optional slot may be enabled per season):

| Slot | Requirement |
|------|-------------|
| 1 | Front Row |
| 2 | Back Row |
| 3 | Outside Back |
| 4 | Weakest nation player (any position) — defaults to **Wales**, configurable per season |
| 5 (optional) | Any player not in a Gameweek 1 starting XV at the time of the draft |

**2026 confirmed:** 4 slots only (Outside Back, Front Row, Back Row, Wales).

### 1.3 Slot eligibility

#### Eligible positions per slot

| Draft slot | Eligible canonical positions |
|------------|------------------------------|
| Front Row | Prop, Hooker |
| Back Row | Flanker, Number 8 |
| Outside Back | Wing, Fullback |
| Weakest nation (Wales by default) | Any position |
| Bench (optional, slot 5) | Any player not in a GW1 starting XV at draft time |

**Positions with no dedicated draft slot:** Second Row, Scrum-half, Fly-half, Centre. These players are freely available for weekly squad selection by any manager, but may only enter the draft via the weakest-nation slot or the bench slot.

#### position_group values

Each player record carries a `position_group` field used to evaluate draft slot eligibility:

| Canonical position | position_group |
|--------------------|----------------|
| Prop | Front Row |
| Hooker | Front Row |
| Second Row | Other |
| Flanker | Back Row |
| Number 8 | Back Row |
| Scrum-half | Other |
| Fly-half | Other |
| Centre | Other |
| Wing | Outside Back |
| Fullback | Outside Back |

`Other` means the player has no dedicated position-based draft slot and may only be drafted via the weakest-nation or bench slot.

#### Overlap and manager choice

A player may be eligible for multiple slots. The manager chooses which slot the pick satisfies.

Example: a Welsh Flanker is eligible for Back Row, Wales, and (if not in a GW1 starting XV) the optional bench slot.

### 1.4 Exclusivity

Drafted players are exclusive. No other manager may select a drafted player in their SPAL squad for the rest of the season, unless an admin overrides it.

### 1.5 Nation limit (draft)

Max **4 drafted players from one nation** per manager.

### 1.6 Timer

- Default pick timer: **2 minutes**
- Configurable by admin
- Live draft is required for normal use
- Async draft mode is a future enhancement (Phase 2/3)
- On-the-clock emails are only sent for async drafts, not live drafts

### 1.7 Optional Bench/Sub slot eligibility

The optional 5th pick must be a player not in a Gameweek 1 starting XV at draft time. This is evaluated at draft time only — it is not retrospectively invalidated if team news later changes, unless admin explicitly corrects it.

---

## 2. Squad rules

Each round, each manager submits a full squad:

```
15 starting players
1 Supersub
```

### 2.1 Position structure

Starters must satisfy these position requirements (configurable as data):

| Position | Count |
|----------|-------|
| Props | 2 |
| Hooker | 1 |
| Second Rows | 2 |
| Back Rows | 3 |
| Scrum-half | 1 |
| Fly-half | 1 |
| Centres | 2 |
| Outside Backs / Back Three | 3 |
| **Total starters** | **15** |
| Supersub | 1 (any position) |

### 2.2 Budget rules

- Budget limit mirrors the official game where possible
- Player prices imported from official feed where available; admin can override
- Budget limit is configurable by season
- Price snapshots by round are supported; official prices may change between rounds
- Squad submission uses the applicable round's final price

**Default assumption:**
```
Budget enabled: true
Budget limit: imported official limit (~200 stars if matching recent official game)
```

### 2.3 Max players per nation

- Default: **max 4 players from one nation** per squad
- Applies to full squad (15 starters + Supersub)
- Configurable per season

### 2.4 Italian starter rule

At least **1 Italian player must start** in the 15 starters.

```json
{
  "enabled": true,
  "required_starters": 1,
  "nation": "Italy",
  "applies_to": "starting_xv",
  "excluded_positions": [],
  "admin_override_allowed": true
}
```

- Reflects league culture and the Sergio Parisse identity
- Excluded positions (if any) are configured via `excluded_positions`, not code
- Enabled by default; admin can override per submission if needed

### 2.5 Ownership restriction

Managers may not select a player drafted by another manager.

Managers may select:
- Their own drafted players
- Any undrafted players

### 2.6 No duplicate players

A player may not appear more than once in a submitted squad.

---

## 3. Captain rule

- Each submitted squad must have exactly **1 Captain** from the 15 starters
- Captain multiplier: **×2**
- Captain selection is made in SPAL and is the private league source of truth
- No requirement for Captain to be a drafted player (legacy note: this was discussed but not locked)

---

## 4. Supersub rule

- Each submitted squad must have exactly **1 Supersub**
- Supersub is separate from (not one of) the 15 starters
- Supersub can be any player not drafted by another manager, subject to budget and other rules

### 4.1 Supersub multipliers (confirmed, configurable)

| Situation | Points applied |
|-----------|---------------|
| Supersub comes off the real-life bench | `final_points × 3` |
| Supersub starts in real life | `final_points × 0.5` |
| Supersub does not play | `0` |

```json
{
  "supersub_bench_multiplier": 3,
  "supersub_starter_multiplier": 0.5,
  "supersub_not_played_points": 0,
  "admin_override_allowed": true
}
```

Note: the 0.5× starter multiplier is drawn from the legacy spreadsheet. Confirm against 2027 official rules before launch.

---

## 5. Scoring model

### 5.1 Player score

```
source_points         — imported from official or manual source
admin_override_points — set by admin if needed
final_points          = admin_override_points ?? source_points
status                = provisional | final | corrected
```

### 5.2 Manager round score

```
Regular starter:          final_points
Captain:                  final_points × captain_multiplier (2)
Supersub from bench:      final_points × supersub_bench_multiplier (3)
Supersub starts:          final_points × supersub_starter_multiplier (0.5)
Supersub does not play:   supersub_not_played_points (0)
```

Then apply any admin penalties.

### 5.3 Decimal handling

Scores preserve decimals internally. Display format is configurable (e.g. 1 decimal place, or whole number if no decimal). Do not round internally unless rules require it.

---

## 6. Head-to-head standings

SPAL maintains both a total-points table and an H2H table.

### 6.1 Normal H2H fixture (pair)

| Result | H2H league points |
|--------|------------------|
| Win | 4 |
| Draw | 2 |
| Loss | 0 |

### 6.2 Triple fixture

Used when the league has an odd number of managers (one rotating triple fixture per gameweek).

| Placing | H2H league points |
|---------|--------------------|
| 1st (highest score) | 4 |
| 2nd | 2 |
| 3rd (lowest score) | 0 |

### 6.3 Triple tie handling (configurable)

| Situation | Points |
|-----------|--------|
| Two tie for 1st | Both receive 3, third receives 0 |
| Two tie for 2nd | First receives 4, tied managers receive 1 each |
| All three tie | All receive 2 |

### 6.4 Odd-number league fixture generation

For a 7-manager league (as in 2026), each of the 5 Six Nations gameweeks has:
- 3 pair fixtures: 6 managers involved
- 1 triple fixture: 3 managers involved

The fixture generator must:
- Create one triple fixture per gameweek
- Ensure every manager appears in at least one triple fixture where mathematically possible
- Balance triple participation as evenly as possible
- Avoid repeat triple combinations where possible
- Avoid repeat pairings where possible
- Allow admin override of any fixture

---

## 7. Squad lock

- Squads lock at the first match kickoff of the round (default)
- Player-level locks are a future enhancement
- Late submissions: blocked by default; admin can override
- Managers can save a draft squad before submitting (to be supported)
