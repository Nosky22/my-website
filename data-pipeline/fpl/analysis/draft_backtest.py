"""Pre-registered walk-forward backtest of the GW1 draft method (three arms).

Runs BEFORE the draft tool is built. For each target season, project GW1-10 from
prior seasons only, pick a 15 three ways, and score each on ACTUAL GW1-10 points
(optimal XI + captain each GW — identical scoring for all arms, so only the
SELECTION differs):

  NAIVE      : maximise last-season TOTAL points under squad constraints — what an
               unaided manager does. (Precise baseline, per the steer.)
  TEMPLATE   : same last-season-total objective + Study 7's structural shape only
               (cheap enabler GK <=5.5, cheap DEF <=6.0 with >=4 nailed, >=1
               mega-premium >=10.0 attacker). No projection machinery.
  PROJECTION : the full discounted GW1-10 projected-points ILP (draft_projection).

Also quantifies TIER-C EXCLUSION: of the retrospective-optimal GW1-10 squad's
points each season, what share came from players who had NO prior at the time
(un-projectable). If large, the manual-include override is load-bearing.

PRE-REGISTERED (fixed before measuring): PROJECTION passes iff it beats NAIVE on
actual GW1-10 points in >= MIN_SEASONS of 5 AND on the pooled total. 3/5 is
coin-flip by chance, so we report the pooled MARGIN in points and the per-season
spread for scale — we do NOT treat 3/5 alone as a pass.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from ingest import query
from analysis import optimizer as O
from analysis import draft_projection as DP
from analysis import params as P

BACKTEST_SEASONS = P.RECORDED_SEASONS[1:]      # need >=1 prior season
MIN_SEASONS = 3                                # of 5 (coin-flip aware — see report)

# operationalised Study 7 template (the structural shape only)
TMPL = dict(gk_max_price=5.5, def_max_price=6.0, def_nailed_min=4,
            premium_min_price=10.0, premium_min_count=1)


def _actual_gw1_10(client, season, horizon):
    actual = defaultdict(lambda: defaultdict(float))
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, total_points", filters={"season_id": season}):
        if r["gw_number"] and r["gw_number"] <= horizon:
            actual[r["player_id"]][r["gw_number"]] += r["total_points"] or 0
    return {p: dict(g) for p, g in actual.items()}


def run(client):
    seasons_out = {}
    for S in BACKTEST_SEASONS:
        pr = DP.build(client, S)
        gws = pr["gws"]
        cands = pr["candidates"]
        actual = _actual_gw1_10(client, S, DP.HORIZON)

        # arms (selection differs; scoring identical on actual points)
        naive = O.solve_squad_by_value(cands, pr["last_total"])
        tmpl = O.solve_squad_by_value(cands, pr["last_total"], nailed_ids=pr["nailed_ids"], **TMPL)
        projn = O.solve_set_and_forget(cands, pr["proj"], gws, startable=None, time_limit=120)

        def score(sq):
            return O.score_fixed_squad(sq.player_ids, cands, actual, gws) if sq.player_ids else 0.0
        sc = {"naive": score(naive), "template": score(tmpl), "projection": score(projn)}

        # ceiling + Tier-C share (all GW1 players incl. no-prior)
        tierc_ids = {t["id"] for t in pr["tierC"]}
        allp = cands + [{"id": t["id"], "position": t["pos"], "price": t["price"], "club": t["club"]}
                        for t in pr["tierC"]]
        ceil = O.solve_set_and_forget(allp, actual, gws, startable=None, time_limit=150)
        ceil_pts = {i: sum(actual.get(i, {}).values()) for i in ceil.player_ids}
        tot = sum(ceil_pts.values()) or 1.0
        tierc_share = sum(v for i, v in ceil_pts.items() if i in tierc_ids) / tot

        seasons_out[S] = {
            "scores": {k: round(v, 1) for k, v in sc.items()},
            "ceiling": round(ceil.total_points, 1),
            "n_candidates": len(cands), "n_tierC": len(pr["tierC"]),
            "tierC_share_of_ceiling": round(tierc_share, 3),
            "proj_minus_naive": round(sc["projection"] - sc["naive"], 1),
            "tmpl_minus_naive": round(sc["template"] - sc["naive"], 1),
            "statuses": {"naive": naive.status, "template": tmpl.status, "projection": projn.status},
        }
    return seasons_out


def summarise(seasons_out):
    pmn = [v["proj_minus_naive"] for v in seasons_out.values()]
    tmn = [v["tmpl_minus_naive"] for v in seasons_out.values()]
    proj_wins = sum(1 for d in pmn if d > 0)
    tmpl_wins = sum(1 for d in tmn if d > 0)
    return {
        "proj_beats_naive_seasons": f"{proj_wins}/{len(pmn)}",
        "tmpl_beats_naive_seasons": f"{tmpl_wins}/{len(tmn)}",
        "proj_minus_naive_pooled": round(sum(pmn), 1),
        "proj_minus_naive_mean": round(statistics.mean(pmn), 1),
        "proj_minus_naive_sd": round(statistics.pstdev(pmn), 1),
        "tmpl_minus_naive_pooled": round(sum(tmn), 1),
        "tmpl_minus_naive_mean": round(statistics.mean(tmn), 1),
        "tmpl_minus_naive_sd": round(statistics.pstdev(tmn), 1),
        "PROJECTION_PASSES": proj_wins >= MIN_SEASONS and sum(pmn) > 0,
        "template_alone_beats_naive": tmpl_wins >= MIN_SEASONS and sum(tmn) > 0,
    }
