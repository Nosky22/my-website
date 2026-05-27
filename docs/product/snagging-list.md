# SPAL Snagging List

## Tier 1 — Must fix before friends use it

### Completed
- [x] Password reset flow
- [x] Fix timer going negative in draft room (already floored at 0 in useDraftSession — no change needed)
- [x] Fix raw Supabase error messages
- [x] Add 404 page
- [x] Fix stub nav pages (laws with real content, history as intentional coming soon)
- [x] Add favicon
- [x] Squad auto-locking at deadline (Netlify scheduled function + admin manual lock)
- [x] Standings showing actual scores not just draft data
- [x] Admin draft setup UI (draft order, session config, slots, quick link to draft room)
- [x] Dashboard mobile layout broken (dashboard, admin scores, admin managers pages)

### Still to do
*(none)*

## Tier 1.5 — Before 2027

- [x] Canonical player identity — migration 014 applied 2026-05-27. canonical_players table, unaccent extension, players.canonical_player_id FK. 127 canonical records, 0 unlinked rows.

## Tier 2 — Should fix for a good experience
- [ ] Invite gate on signup
- [ ] Season rules editable from admin UI
- [ ] Success toast/notification system
- [ ] Player search on players and admin players pages
- [ ] Confirmation on destructive admin actions
- [ ] Submit squad confirmation
- [ ] Round marked as final in UI
- [ ] Admin override points UI
- [ ] Show logged-in user identity in SPAL nav — display the manager's display name when logged in, replacing or augmenting the current Sign out button. Show "Not signed in" or a Sign in prompt when logged out.
- [ ] Separate League Table and H2H Cup — the main standings should rank managers by total points only. H2H competition becomes a separate "Head to Head Cup" with its own table ranked by H2H points and W/D/L record. Build as a separate page at /spal/h2h. Update standings page to be points-only. No database changes needed — scoring engine already calculates both.

## Tier 3 — Polish
- [ ] Empty state illustrations
- [ ] Admin imports/settings stubs replaced with proper content
- [ ] Score result table formatting
- [ ] Draft board slot context improvements

## Historical Data & Records
- [ ] Historical season results page
- [ ] All-time league table
- [ ] Manager profile pages
- [ ] Season review pages
- [ ] All-time top players
- [ ] Historical draft records

## Scoring & Data
- [ ] Live score updates during matches — final scores only for v1 recommended
- [ ] Official API adapter for 2027 — officialFantasyAdapter Edge Function using /v1/flux, ready for January 2027
- [ ] Team sheet import — admin UI to import official starting XVs when announced Thursday/Friday pre-round
- [ ] Late change handling — admin can update matchday status after initial import
- [ ] Price updates per round — mechanism to update player prices between rounds via API or manual entry

## Manager Experience
- [ ] Visual workflow indicator — already built on dashboard, continue refining
- [ ] Display official team sheets to managers before squad deadline
- [ ] Keep SPAL in step with official game schedule

## Technical & Performance
- [ ] Round locking — auto-lock at deadline, copy previous squad if none submitted
- [ ] Score states — provisional vs final, admin marks round as final
- [ ] Mobile responsive audit and fixes
- [ ] Loading states and error handling across all pages
- [ ] Performance — caching, reduce unnecessary fetches
