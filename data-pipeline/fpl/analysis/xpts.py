"""Match expected points from expected goals, via independent Poisson.

KNOWN BIAS (recorded in provenance): independent Poisson systematically
UNDER-predicts draws — the exact deficiency Dixon–Coles corrects. It biases
teams roughly equally, so RELATIVE pts_vs_xpts stays useful, but ABSOLUTE xPts
carries the bias. Dixon–Coles is a documented future refinement, not v1.

Team match xG is aggregated from player_gameweeks.expected_goals, with each
player assigned to a side via opponent_team_id + the fixture's home/away ids
(NOT players.team_id, which is end-of-season club). full_xg seasons only.
"""
from __future__ import annotations

import math

from ingest import query


def match_xpts(xg_for: float, xg_against: float, max_goals: int = 10) -> float:
    """Expected league points (3/1/0) for the home-perspective team."""
    pf = [math.exp(-xg_for) * xg_for ** k / math.factorial(k) for k in range(max_goals + 1)]
    pa = [math.exp(-xg_against) * xg_against ** k / math.factorial(k) for k in range(max_goals + 1)]
    p_win = p_draw = 0.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p = pf[i] * pa[j]
            if i > j:
                p_win += p
            elif i == j:
                p_draw += p
    return 3.0 * p_win + 1.0 * p_draw


def team_match_xg(client, season: str) -> dict[tuple[int, int], float]:
    """{(fixture_id, team_id) → team xG for that match} from player xG.

    team_id is derived per row from opponent_team_id + fixture home/away.
    """
    fx = {f["id"]: f for f in query.fetch_all(client, "fixtures",
          "id, home_team_id, away_team_id", filters={"season_id": season})}
    agg: dict[tuple[int, int], float] = {}
    rows = query.fetch_all(client, "player_gameweeks",
        "fixture_id, opponent_team_id, expected_goals", filters={"season_id": season})
    for r in rows:
        f = fx.get(r["fixture_id"])
        if not f or r["expected_goals"] is None or r["opponent_team_id"] is None:
            continue
        # player's team = the fixture side that is NOT the opponent
        opp = r["opponent_team_id"]
        team = f["home_team_id"] if opp == f["away_team_id"] else (
               f["away_team_id"] if opp == f["home_team_id"] else None)
        if team is None:
            continue
        key = (r["fixture_id"], team)
        agg[key] = agg.get(key, 0.0) + float(r["expected_goals"])
    return agg
