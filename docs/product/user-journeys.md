# SPAL User Journeys

Three roles interact with SPAL: Admin, Manager, and Guest.

---

## Admin (Commissioner)

There is one admin/commissioner. The admin controls season setup, imports, overrides, and all league administration.

### Season setup

```
1.  Create season (year, status: setup)
2.  Configure rules (budget, position requirements, nation limits, Italian starter rule, weakest nation)
3.  Import player list
4.  Import prices
5.  Import fixtures
6.  Review and resolve data quality issues
7.  Set weakest nation for the season
8.  Create league
9.  Invite managers
10. Enter previous-year standings (to determine draft order)
11. Generate draft order (reverse of previous standings)
12. Schedule draft
```

### Import and data review

```
1. Run import (player list, prices, fixtures, scores, matchday squads)
2. Review import health dashboard
3. Resolve unmatched players, ambiguous positions, missing prices
4. Apply overrides where needed (name, nation, position, price, score)
5. All overrides are audited with reason, old value, new value
```

### Live draft

```
1.  Start draft
2.  Monitor current pick — manager is on the clock
3.  Pause or resume draft if needed
4.  Manually assign pick if manager is unavailable
5.  Undo pick if mistake is caught immediately
6.  Draft board updates in real time for all participants
```

### Round management

```
1. Confirm round is open and squad submissions are unlocked
2. Import matchday squads (to confirm Supersub real-life status)
3. Import player scores after matches
4. Review provisional scores
5. Apply any overrides (score corrections, penalty adjustments)
6. Finalise round (locks scores, triggers standings recalculation)
7. Publish Chronicle post (results write-up, optional)
8. Notifications sent to managers
```

### Guest link management

```
1. Generate guest share token (opaque, hashed on storage)
2. Share link with intended viewers
3. Revoke link if needed
4. Optionally set expiry date
```

---

## Manager

Managers are invited by the admin. There is no self-registration.

### Onboarding

```
1. Receive email invite
2. Click invite link, sign in via Supabase Auth
3. Set display name and team name
4. Read The Laws (rules page)
5. View draft order
6. (Optional) Build draft watchlist if feature is available
```

### Live draft participation

```
1. Join draft room at scheduled time
2. View draft board — drafted players, remaining pool, position filters
3. When on the clock: select player, choose which draft slot the pick satisfies
4. Confirm pick — server validates eligibility
5. Draft board updates in real time after each pick
6. Watch other managers' picks between turns
```

### Weekly squad submission

```
1. Open My Squad before round deadline
2. View available players (all undrafted + own drafted players)
3. Select 15 starters (must satisfy position requirements)
4. Select 1 Supersub
5. Select 1 Captain from the starters
6. Monitor budget bar — must stay within budget limit
7. See real-time validation: positions, nation limits, Italian starter rule, ownership
8. Fix any validation errors before submitting
9. Submit squad
10. Squad locks at round deadline (first match kickoff)
```

### Viewing league data

Managers can view at any time (no additional login required once authenticated):

- League dashboard: current standings, recent fixtures, squad submission status
- Standings: total-points table and H2H table
- Fixtures: upcoming and past H2H and triple fixtures
- Draft board: all picks, draft order, ownership by manager and position
- Player list: all players, prices, positions, current ownership
- My Squad: own current and past squads with scoring breakdown
- Stats: player analytics, manager analytics, draft value analysis
- History: past seasons, champions, all-time table
- Chronicle: weekly write-ups and league posts

### Notifications received

- Round deadline approaching (squad not yet submitted)
- Squad submitted confirmation
- Round scores finalised
- H2H fixture result
- Admin data correction affecting own squad or score
- Draft: async on-the-clock notification (async draft mode only)

---

## Guest viewer

Guests access SPAL via a private share link provided by the admin. No login required.

### Accessing the guest view

```
1. Open the private share link
2. Token is validated server-side
3. Guest view loads — no sign-in required
4. All guest-visible content is available immediately
```

### What guests can view

- Dashboard (current standings summary)
- Total-points and H2H standings tables
- Fixtures: Six Nations fixtures and SPAL H2H fixtures
- Draft board: all picks, draft order, player ownership
- Player list: players, positions, prices (no manager-private data)
- Stats: player and league-level analytics
- History: past seasons, champions, all-time records
- The Laws (rules page)
- Chronicle posts marked as guest-visible

### What guests cannot do

- Sign in or create an account
- Edit any data
- Submit squads
- See manager email addresses
- See admin notes, raw import payloads, or audit data
- See Chronicle posts marked managers-only

---

## Public (no login, no guest token)

Some pages are accessible to anyone without authentication:

- `/spal/` — landing page explaining SPAL
- `/spal/laws` — The Laws (rules page)
- `/spal/history` — historical standings and champions

Everything else requires either a manager login or a valid guest token.
