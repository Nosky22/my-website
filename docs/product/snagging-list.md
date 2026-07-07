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
- [x] Admin override points UI — override field in score entry form; takes precedence over source score; requires reason; writes audit record to admin_overrides; triggers quiet score recalculation.
- [x] Show logged-in user identity in SPAL nav — display_name shown next to Sign out button when logged in.
- [x] Separate League Table and H2H Cup — StandingsPage ranks by total points only; H2HPage at /h2h has W/D/L record, H2H points table, and Cup Results section showing round-by-round fixtures with scores and W/D/L outcomes.

## Tier 3 — Polish
- [x] Empty state illustrations
- [x] Admin imports/settings stubs replaced with proper content
- [x] Score result table formatting
- [x] Draft board slot context improvements

## Historical Data & Records
- [x] Historical season results page — SeasonReviewPage at /history/:year with standings, scores, squad builder, draft board, predos, insights.
- [x] All-time league table — AllTimePage at /alltime with cumulative manager standings across seasons; Records section showing highest round, best season, most predo points, most consistent manager, and most titles.
- [x] Manager profile pages — ManagerProfilePage at /manager/:profileId; enhanced with H2H record vs each opponent, best single round score, per-season predo points column, favourite nation, and most-drafted player.
- [x] Season review pages — SeasonReviewPage (see above).
- [x] All-time top players — PlayersAllTimePage at /players/alltime; total pts, seasons, avg/season, best round; nation + position filters; linked from PlayersPage and AllTimePage; Top Players in nav.
- [x] Historical draft records — draft board section included in SeasonReviewPage.

## Scoring & Data
- [ ] Live score updates during matches — final scores only for v1 recommended
- [ ] Official API adapter — build officialFantasyAdapter Edge Function using /v1/flux endpoint. Target: November/December 2026 ready for January 2027 season.
- [x] Team sheet import — built at /admin/teamsheets with manual entry and CSV import.
- [x] Late change handling — inline Edit button on each player row in /admin/teamsheets; changes starting/bench/not_selected after import; amber warning shown if round is scored; post-save note links to Scores page for recalculation
- [ ] Price updates per round — mechanism to update player prices between rounds via API or manual entry

## Manager Experience
- [x] Enhanced homepage for logged-in managers — personalised hub with standings, Chronicle posts, insights preview, quick actions
- [x] Dashboard season selector + profile summary card with inline team_name editing
- [x] Visual workflow indicator — active-season only; step numbers (1-5) in incomplete circles; "Scores available" label; green ticks on done steps; current step highlighted in cerulean
- [ ] Display official team sheets to managers before squad deadline
- [ ] Keep SPAL in step with official game schedule
- [x] Squad builder draft picks panel — player picker opens on a "My Picks" tab showing the manager's own drafted players eligible for the slot; "All Available" tab gives access to the full pool.
- [x] Comprehensive status indicators on Home/Dashboard — action items panel on logged-in homepage: squad submitted, predos entered, team sheets available, round scored; pending items shown with CTA links; completed items shown with tick.
- [x] Predos page UX improvements — (1) defaults to active season and current live round on load; (2) locked-state banner after deadline showing manager's own submitted predictions read-only with correct/wrong indicators once results are in; (3) My Predictions History section for logged-in managers: per-round breakdown with pick vs actual result, correct/wrong indicator, round score, and season total.
- [x] Standings page per-round breakdown — toggle between Summary and Round by Round views; Round by Round shows R1–Rn columns; highest score each round highlighted in gold; unscored rounds show —.
- [x] Consistent season/round defaults across all pages — StandingsPage, H2HPage, InsightsPage, PredosPage all updated to prefer active season and current round on load.
- [ ] "Add to squad" from Team Sheets page — allow a logged-in manager to add a player directly to their current (unsubmitted) squad from the /spal/teamsheets page, without navigating to the squad builder separately.

## Admin Management
- [x] Admin Predos management — /admin/predos: view all manager predictions for any round (admin bypasses deadline), per-row edit/delete/add, highlight managers with no predos, reset predo scores for a round with confirmation.
- [ ] Admin Chronicle management improvements — ability to edit and delete comments (admin moderation), pin posts, manage post order, insights embed syntax in post body.
- [x] Admin scores page — "Close round" one-click pipeline: lock squads → calculate scores → calculate predo scores → generate insights → mark as final, with live step-by-step progress indicators; stops and shows error if any step fails.
- [x] Admin round deadline management — "Kickoff times" section on scores page with datetime inputs per match, shift-all-by-N-hours convenience control, and reason field; each change audited in admin_overrides.
- [x] Admin squad override — /admin/squad-override: select season + round + manager, edit their full 16-slot squad (bypasses deadline), saves as submitted. Audit logged to audit_log.
- [x] Admin predo override — on the same /admin/squad-override page: edit or add predo predictions on behalf of a manager, bypassing deadline. Edits write to admin_overrides; new entries write to audit_log.
- [x] Copy invite link on /admin/managers — "Copy invite link" button on each placeholder manager row; reuses any existing unclaimed token or generates fresh if none exist; copies full signup URL to clipboard.
- [x] Score correction flow — "Recalculate needed" amber warning banner appears when a score is corrected after a round is final; one-click "Recalculate & re-finalise" button re-runs full pipeline (skipping squad lock) and clears the banner.
- [x] In-app notifications — bell icon in SPAL nav with unread count badge; dropdown list of recent notifications with loading/error states; generated when round scores are published or a Chronicle post goes live; marked read on open; migration 025.
- [x] Chronicle starter posts — 3 published posts inserted via SQL: "Welcome to SPAL", "How scoring works", "What is the Chronicle?" — dated to 2023 Six Nations opening weekend, authored by Nick.

## Technical & Performance
- [x] Round locking — auto-lock at deadline, copy previous squad if none submitted (Netlify scheduled function + AdminScoresPage manual lock).
- [x] Score states — provisional vs final; admin marks round as final in AdminScoresPage; standings shows last_updated_round.
- [x] Mobile responsive audit and fixes — PlayerRow edit state fixed; overflow-x-auto on prediction tables; all pages checked at 375px.
- [x] Loading states and error handling across all pages — including notification bell loading/error states.
- [x] Empty states audit — EmptyState component used consistently; no-history state on manager profiles; no-matches state on predos.
- [x] Page titles — document.title set on all 38 pages; dynamic titles for ManagerProfile, SeasonReview, ChroniclePost.
- [ ] Performance — caching, reduce unnecessary fetches

---

## Post-beta outstanding — what genuinely remains

### Scoring & data (pre-season 2027 deadline)
- **Official API adapter** — the officialFantasyAdapter Edge Function using /v1/flux. Nick: target Nov/Dec 2026 so it's ready for the January 2027 season kick-off.
- **Price updates per round** — no mechanism to update player prices mid-season via API or manual entry.
- **Live score updates** — agreed that final-only scores are fine for v1; revisit if managers want intra-round updates.

### Manager features
- **Display official team sheets to managers** — before the squad deadline, managers should be able to see the published team sheets at /spal/teamsheets without needing admin access.
- **"Add to squad" from Team Sheets** — one-click add from /spal/teamsheets into the manager's current (unsubmitted) squad. Complex: needs slot selection, validation, and squad state awareness.
- **Keep SPAL in step with official game schedule** — round dates, bye weeks, and scheduling changes need a process to stay current.

### Admin tools
- **Admin Chronicle management improvements** — edit/delete comments (moderation), pin posts, manage post order, insights embed syntax.

### Technical
- **Performance** — no caching layer; pages re-fetch on every mount. Worth revisiting once real traffic exists.
