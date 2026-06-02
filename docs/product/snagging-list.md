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
- [x] Invite gate on signup — SignUpPage validates invite token against invite_tokens table before allowing registration.
- [x] Season rules editable from admin UI — AdminSeasonsPage has a full rules editor (reads/writes season_rules table).
- [x] Success toast/notification system — Toast component + useToast hook; toasts on AdminSeasons, AdminPlayers, AdminScores, Squad, AdminManagers
- [x] Player search on players and admin players pages — both PlayersPage and AdminPlayersPage have search + filter inputs.
- [x] Confirmation on destructive admin actions — ConfirmModal on Start Draft, Reopen Draft, and manager merge
- [x] Submit squad confirmation — ConfirmModal on SquadPage before final submission.
- [x] Round marked as final in UI — AdminScoresPage has "Finalise round" action; standings display last_updated_round.
- [ ] Admin override points UI — score entry form only handles source_points; no separate field to set admin_override_points independently.
- [x] Show logged-in user identity in SPAL nav — display_name shown next to Sign out button when logged in.
- [x] Separate League Table and H2H Cup — StandingsPage ranks by total points only; H2HPage at /h2h has W/D/L record and H2H points table.

## Tier 3 — Polish
- [ ] Empty state illustrations
- [ ] Admin imports/settings stubs replaced with proper content
- [ ] Score result table formatting
- [ ] Draft board slot context improvements

## Historical Data & Records
- [x] Historical season results page — SeasonReviewPage at /history/:year with standings, scores, squad builder, draft board, predos, insights.
- [x] All-time league table — AllTimePage at /alltime with cumulative manager standings across seasons.
- [x] Manager profile pages — ManagerProfilePage at /manager/:profileId.
- [x] Season review pages — SeasonReviewPage (see above).
- [ ] All-time top players — no player-level all-time records page yet.
- [x] Historical draft records — draft board section included in SeasonReviewPage.

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
- [x] Round locking — auto-lock at deadline, copy previous squad if none submitted (Netlify scheduled function + AdminScoresPage manual lock).
- [x] Score states — provisional vs final; admin marks round as final in AdminScoresPage; standings shows last_updated_round.
- [ ] Mobile responsive audit and fixes
- [ ] Loading states and error handling across all pages
- [ ] Performance — caching, reduce unnecessary fetches
