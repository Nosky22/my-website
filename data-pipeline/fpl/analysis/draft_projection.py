"""GW1 draft projection — walk-forward priors for a target season (no lookahead).

Builds a per-player, per-gameweek projected-points matrix for GW1..HORIZON using
ONLY data from seasons before the target. This is the honest input to the draft
tool (§5.5b / §5.13 Tier 1) and to its pre-registered backtest.

Study 6's null (fixture adds nothing beyond season-to-date ppg) does NOT apply at
GW1: there is no season-to-date ppg yet. So inputs are ranked per §5.5e:
  (b) start_rate      — last-season minutes-stability prior (archetype axis)
  (c) ppg_started     — last-season quality prior (kept separate per RULE_4)
  (d) fixture_mult    — fixture-adjusted relative ELO for the specific opening
                        fixtures; non-decaying (Study 3), so valid to GW10.
  proj[p][g] = start_rate * ppg_started * fixture_mult[g]

DISCOUNTING (γ): γ models (i) PLAN REVISION — you will wildcard around GW8-12, so
later gameweeks are progressively LESS determined by the GW1 pick — and (ii)
growing prior uncertainty with horizon. It is NOT signal decay: Study 3 showed the
fixture component does not decay, and start_rate/ppg_started are season-long priors
with no internal decay structure. So γ here ≈ 0.92 (mild); do NOT "correct" it to
the community's 0.84 signal-decay value — that would be a category error.

Three data tiers, surfaced not buried (design note 2):
  A: has a prior-season archetype  -> full prior, in the projection.
  B: played before but never classified (<10-game archetype threshold) -> crude
     prior from most recent prior season, flagged "limited".
  C: no prior season at all -> EXCLUDED from the auto-projection, returned as a
     watchlist ("no data — your judgement required"). Never ranked at 0.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from ingest import query
from analysis import params as P

RAW_DIR = Path(__file__).parent.parent / "raw"

HORIZON = 10
GAMMA = 0.92               # plan-revision + prior-uncertainty discount (NOT decay)
STARTER_MIN = 60
FIX_BETA = 0.30            # fixture multiplier strength (heuristic, tunable)
FIX_CLIP = (0.70, 1.30)


def _regress(elo: float) -> float:
    return 1500.0 + (1.0 - P.BOUNDARY_REGRESSION) * (elo - 1500.0)


def _fixture_mult(rel_elo: float) -> float:
    m = 1.0 + FIX_BETA * (rel_elo / 400.0)
    return max(FIX_CLIP[0], min(FIX_CLIP[1], m))


def _prior_seasons(target: str) -> list[str]:
    if target in P.RECORDED_SEASONS:                 # backtest: seasons strictly before
        return list(P.RECORDED_SEASONS[:P.RECORDED_SEASONS.index(target)])
    return list(P.RECORDED_SEASONS)                  # live new season: all recorded are prior


def prev_season(target: str) -> str:
    if target in P.RECORDED_SEASONS:
        return P.RECORDED_SEASONS[P.RECORDED_SEASONS.index(target) - 1]
    return P.RECORDED_SEASONS[-1]                     # live new season: latest recorded


def _gw1_price_club(client, season):
    """(price, club) per internal player_id for GW1. In-season: from the GW1
    player_gameweek row. Pre-season (no gameweeks yet): bootstrap now_cost +
    current club."""
    fx = {f["id"]: f for f in query.fetch_all(client, "fixtures",
            "id, home_team_id, away_team_id, gw_number", filters={"season_id": season})}
    price, club = {}, {}
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, value", filters={"season_id": season}):
        if r["gw_number"] == 1 and r["value"] is not None and r["was_home"] is not None:
            f = fx.get(r["fixture_id"])
            if f:
                price[r["player_id"]] = float(r["value"])
                club[r["player_id"]] = f["home_team_id"] if r["was_home"] else f["away_team_id"]
    if price:
        return price, club
    # pre-season fallback: bootstrap now_cost + players.team_id (current club)
    bs = json.loads((RAW_DIR / season / "bootstrap-static.json").read_text())
    cost = {e["id"]: e["now_cost"] for e in bs["elements"]}
    for r in query.fetch_all(client, "players", "id, fpl_element_id, team_id",
                             filters={"season_id": season}):
        nc = cost.get(r["fpl_element_id"])
        if nc is not None and r["team_id"] is not None:
            price[r["id"]] = nc / 10.0
            club[r["id"]] = r["team_id"]
    return price, club


def build(client, target_season: str) -> dict:
    priors = _prior_seasons(target_season)
    if not priors:
        raise ValueError(f"{target_season} has no prior season to project from")

    # players across target + priors: pid -> meta; canonical -> {season: pid}
    seasons = priors + [target_season]
    pmeta, canon_pid = {}, defaultdict(dict)
    for s in seasons:
        for r in query.fetch_all(client, "players",
                "id, canonical_id, team_id, position, web_name", filters={"season_id": s}):
            pmeta[r["id"]] = {"canon": r["canonical_id"], "season": s,
                              "team_id": r["team_id"], "pos": r["position"], "name": r["web_name"]}
            canon_pid[r["canonical_id"]][s] = r["id"]

    # prior per-season aggregates: canonical -> season -> {total, starts, ppg_started}
    prior_stats = defaultdict(dict)
    for s in priors:
        agg = defaultdict(lambda: {"total": 0, "starts": 0})
        for r in query.fetch_all(client, "player_gameweeks",
                "player_id, minutes, total_points", filters={"season_id": s}):
            a = agg[r["player_id"]]
            a["total"] += r["total_points"] or 0
            if (r["minutes"] or 0) >= STARTER_MIN:
                a["starts"] += 1
        for pid, a in agg.items():
            canon = pmeta[pid]["canon"]
            if a["starts"] > 0:
                prior_stats[canon][s] = {"total": a["total"], "starts": a["starts"],
                                         "ppg_started": a["total"] / a["starts"]}

    # prior archetypes (most recent prior season): canonical -> (start_rate, ppg_started, season)
    arch_prior = {}
    for s in priors:                                  # oldest->newest, keep newest
        for r in query.fetch_all(client, "player_archetypes",
                "player_id, start_rate, ppg_started, archetype", filters={"season_id": s}):
            canon = pmeta.get(r["player_id"], {}).get("canon")
            if canon is not None and r["start_rate"] is not None:
                arch_prior[canon] = {"start_rate": float(r["start_rate"]),
                                     "ppg_started": float(r["ppg_started"] or 0),
                                     "archetype": r["archetype"], "season": s}

    # ELO prior per TARGET team (regressed most-recent prior final elo by code; promoted 1350)
    code_by_team = {r["id"]: r["code"] for s in seasons
                    for r in query.fetch_all(client, "teams", "id, code", filters={"season_id": s})}
    prior_final_elo_by_code = {}
    for s in priors:
        finals = {}
        for r in query.fetch_all(client, "team_elo", "team_id, gw_number, elo",
                                 filters={"season_id": s}, order="id"):
            code = code_by_team.get(r["team_id"])
            if code is None:
                continue
            cur = finals.get(code)
            if cur is None or r["gw_number"] > cur[0]:
                finals[code] = (r["gw_number"], float(r["elo"]))
        for code, (_, e) in finals.items():
            prior_final_elo_by_code[code] = e         # newest season overwrites
    target_team_ids = {r["id"]: r["code"] for r in query.fetch_all(
        client, "teams", "id, code", filters={"season_id": target_season})}
    elo_prior = {tid: (_regress(prior_final_elo_by_code[code])
                       if code in prior_final_elo_by_code else P.PROMOTED_ELO)
                 for tid, code in target_team_ids.items()}
    promoted_team_ids = {tid for tid, code in target_team_ids.items()
                         if code not in prior_final_elo_by_code}

    # target fixtures GW1..HORIZON: (team_id, gw) -> opponent_team_id
    opp = defaultdict(dict)
    for f in query.fetch_all(client, "fixtures",
            "home_team_id, away_team_id, gw_number", filters={"season_id": target_season}):
        g = f["gw_number"]
        if g and 1 <= g <= HORIZON:
            opp[f["home_team_id"]][g] = f["away_team_id"]
            opp[f["away_team_id"]][g] = f["home_team_id"]

    # target GW1 price + club: from the GW1 player_gameweek row (in-season / historical),
    # or — pre-season, when no gameweeks are played yet — from the bootstrap now_cost +
    # current club (players.team_id).
    gw1_price, gw1_club = _gw1_price_club(client, target_season)

    # ── assemble candidates + projection ──────────────────────────────────
    candidates, tierC, meta = [], [], {}
    proj, last_total = {}, {}
    for pid, price in gw1_price.items():
        info = pmeta.get(pid)
        if info is None or info["pos"] not in ("GKP", "DEF", "MID", "FWD"):
            continue
        canon, team = info["canon"], gw1_club[pid]
        # pick the prior: archetype (Tier A) > crude prior stats (Tier B) > none (Tier C)
        tier = start_rate = ppg_st = prior_season = None
        if canon in arch_prior:
            ap = arch_prior[canon]
            tier, start_rate, ppg_st, prior_season = "A", ap["start_rate"], ap["ppg_started"], ap["season"]
        elif canon in prior_stats:
            latest = max(prior_stats[canon])                # most recent prior season with starts
            ps = prior_stats[canon][latest]
            tier, prior_season = "B", latest
            start_rate = min(1.0, ps["starts"] / 38.0)
            ppg_st = ps["ppg_started"]
        else:
            tierC.append({"id": pid, "name": info["name"], "pos": info["pos"],
                          "price": price, "club": team,
                          "reason": "no prior season — new signing / promoted-club debutant / youth",
                          "promoted_club": team in promoted_team_ids})
            continue

        # last-season total (naive/template value); from the prior season used
        lt = 0
        if canon in prior_stats:
            src = prior_season if prior_season in prior_stats[canon] else max(prior_stats[canon])
            lt = prior_stats[canon][src]["total"]
        last_total[pid] = lt

        # moved-club / stale-prior flag: target club's code differs from prior-season club's code
        prior_pid = canon_pid[canon].get(prior_season)
        prior_team = pmeta.get(prior_pid, {}).get("team_id") if prior_pid else None
        moved = (code_by_team.get(prior_team) != code_by_team.get(team)) if prior_team else True

        own_elo = elo_prior.get(team, P.PROMOTED_ELO)
        row = {}
        for g in range(1, HORIZON + 1):
            o = opp.get(team, {}).get(g)
            mult = _fixture_mult(own_elo - elo_prior.get(o, 1500.0)) if o is not None else 1.0
            row[g] = (GAMMA ** (g - 1)) * start_rate * ppg_st * mult
        proj[pid] = row
        candidates.append({"id": pid, "position": info["pos"], "price": price, "club": team})
        meta[pid] = {"name": info["name"], "tier": tier, "prior_season": prior_season,
                     "start_rate": round(start_rate, 3), "ppg_started": round(ppg_st, 2),
                     "moved_club": moved, "promoted_club": team in promoted_team_ids}

    nailed_ids = {pid for pid in meta
                  if arch_prior.get(pmeta[pid]["canon"], {}).get("archetype") == "nailed"}
    # per-team opening-run difficulty (mean fixture-adjusted rel-ELO over GW1..HORIZON),
    # returned as CONTEXT only — never enters selection (the backtest showed it adds noise)
    fixture_ctx = {}
    for tid, own_elo in elo_prior.items():
        diffs = [own_elo - elo_prior.get(o, 1500.0)
                 for g in range(1, HORIZON + 1) if (o := opp.get(tid, {}).get(g)) is not None]
        fixture_ctx[tid] = round(sum(diffs) / len(diffs), 0) if diffs else 0.0
    return {"target_season": target_season, "gws": list(range(1, HORIZON + 1)),
            "candidates": candidates, "proj": proj, "last_total": last_total,
            "nailed_ids": nailed_ids, "tierC": tierC, "meta": meta,
            "elo_prior": elo_prior, "promoted_team_ids": promoted_team_ids,
            "fixture_ctx": fixture_ctx,
            "params": {"gamma": GAMMA, "horizon": HORIZON, "fix_beta": FIX_BETA}}
