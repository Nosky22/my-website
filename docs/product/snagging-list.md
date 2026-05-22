# SPAL Snagging List

Known gaps, polish items, and planned improvements. Checked items are done.

---

## UI & Polish

## Manager Experience

- [ ] Visual workflow indicator for managers — a clear status display showing where each manager is in the process (draft complete, squad submitted, round locked, scores available etc.) and what actions they need to take next. Should be prominent on the manager dashboard.
- [ ] Display official team sheets to managers before squad deadline — show starting XVs, bench, and reserves for each match in the round once announced.
- [ ] Keep SPAL in step with official game — squad selection window should open when official game opens (after previous round scores finalise). Consider linking round deadlines to official game deadlines.

## Admin & Commissioner Tools

## Scoring & Data

- [ ] Live score updates during matches — decide whether to support provisional scores during matches or final scores only. Recommended: final scores only for v1.
- [ ] Official API adapter for 2027 — build the officialFantasyAdapter Edge Function using /v1/flux endpoint, ready for January 2027 when the Men's game goes live. Requires admin to provide their api_key in settings.
- [ ] Team sheet import — admin UI to import or manually enter official starting XVs when announced (Thursday/Friday pre-round). Populates matchday_squads. Should show starters, bench, and reserves separately.
- [ ] Late change handling — admin can update a player's matchday status after initial import (e.g. late injury replacement). Re-running score-round recalculates automatically.
- [ ] Price updates per round — mechanism for admin to update player prices between rounds, either via API import or manual entry.

## Technical & Performance

- [ ] Round locking — auto-lock squads at deadline, copy previous round squad for managers who haven't submitted. Admin override available.
- [ ] Score states — provisional vs final scores. Admin marks a round as final after all scores confirmed.

## Historical Data & Records

- [ ] Historical season results — managers can view final standings for each completed season showing total points, position, H2H record
- [ ] All-time league table — aggregated across all historical seasons: total points, seasons played, average points per season, wins, best finish
- [ ] Manager profile page — individual manager's history across all seasons: each season's position, points, best/worst round, most valuable player in their squad
- [ ] Season review page — for each completed season: final standings, top scoring players, round by round results, draft board, notable moments
- [ ] All-time top players — players who have scored the most points across all seasons they appeared in SPAL squads
- [ ] Historical draft records — which managers have drafted which players across seasons, who has the best draft record

## Future Features
