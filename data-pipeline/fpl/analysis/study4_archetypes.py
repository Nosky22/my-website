"""Study 4 — player-archetype classification (§5.5e).

Steers honoured:
  1. PER-PLAYER stability (not aggregates) — classify each player-season by its
     OWN minutes-persistence, since the aggregate MID h1=0.72 is a mixture.
  2. CORE = PREDICTABLE, not GOOD — the archetype axis is STABILITY (start-rate
     + minutes consistency). Quality (ppg) is a SEPARATE reported dimension.
  3. WALK-FORWARD — a season's classification is available for USE at GW1 of the
     NEXT season; the key deliverable is cross-season persistence.
  4. Cross-season persistence is THE question: does archetype hold S → S+1?
  5. Third archetype only if the evidence (nailed × fixture-sensitivity) supports.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from ingest import query
from analysis import stats
from analysis import params as P

STARTER_MIN = 60
MIN_APPEARANCES = 10          # below this, a player-season is unclassifiable (thin)

# Stability thresholds (start-rate = starts / season GWs). Tunable, judgement.
NAILED_MIN = 0.75            # >=75% of GWs started → predictable starter (core)
ROTATION_MIN = 0.35         # 35-75% → rotation risk; <35% → fringe/bench


def _season_gw_count(client, season):
    gws = {f["gw_number"] for f in query.fetch_all(client, "fixtures", "gw_number",
           filters={"season_id": season})}
    return len(gws)


def player_seasons(client, season):
    """Per player-season: stability + quality + fixture-sensitivity metrics."""
    players = {p["id"]: p for p in query.fetch_all(client, "players",
               "id, canonical_id, web_name, position", filters={"season_id": season})}
    fixtures = {f["id"]: f for f in query.fetch_all(client, "fixtures",
                "id, gw_number, home_team_id, away_team_id", filters={"season_id": season})}
    elo = {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}
    season_gws = _season_gw_count(client, season)

    # aggregate per (player, gw)
    byp = defaultdict(lambda: defaultdict(lambda: {"pts": 0, "min": 0, "team": None, "opp": None}))
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, minutes, total_points, opponent_team_id",
            filters={"season_id": season}):
        f = fixtures.get(r["fixture_id"])
        if f is None or r["was_home"] is None:
            continue
        a = byp[r["player_id"]][r["gw_number"]]
        a["pts"] += r["total_points"] or 0
        a["min"] += r["minutes"] or 0
        a["team"] = f["home_team_id"] if r["was_home"] else f["away_team_id"]
        a["opp"] = r["opponent_team_id"]

    out = []
    for pid, gwmap in byp.items():
        p = players.get(pid)
        if not p:
            continue
        recs = [(gw, d) for gw, d in sorted(gwmap.items())]
        apps = [d for _, d in recs if d["min"] >= 1]
        if len(apps) < MIN_APPEARANCES:
            continue
        starts = [d for _, d in recs if d["min"] >= STARTER_MIN]
        start_rate = len(starts) / season_gws
        ppg_started = statistics.mean([d["pts"] for d in starts]) if starts else 0.0
        # minutes consistency among appearances (lower CV = steadier)
        mins = [d["min"] for d in apps]
        cv_min = (statistics.pstdev(mins) / statistics.mean(mins)) if statistics.mean(mins) else None
        # fixture-sensitivity: Spearman(rel-ELO, points) over started GWs (noisy, thin)
        xs, ys = [], []
        for gw, d in recs:
            if d["min"] >= STARTER_MIN and d["team"] and d["opp"]:
                oe = elo.get((d["opp"], gw - 1)); te = elo.get((d["team"], gw - 1))
                if oe is not None and te is not None:
                    xs.append(te - oe); ys.append(d["pts"])
        fix_sens = stats.spearman(xs, ys) if len(xs) >= 8 else None
        out.append({
            "season": season, "player_id": pid, "canonical_id": p["canonical_id"],
            "web_name": p["web_name"], "position": p["position"],
            "appearances": len(apps), "starts": len(starts), "start_rate": round(start_rate, 3),
            "ppg_started": round(ppg_started, 2),
            "minutes_cv": round(cv_min, 3) if cv_min is not None else None,
            "fixture_sensitivity": round(fix_sens, 3) if fix_sens is not None else None,
            "archetype": classify(start_rate),
        })
    return out


def classify(start_rate: float) -> str:
    if start_rate >= NAILED_MIN:
        return "nailed"       # core / set-and-forget (STABILITY, not quality)
    if start_rate >= ROTATION_MIN:
        return "rotation"     # fixture/form-dependent, plan 1-2 windows
    return "fringe"           # rarely starts / bench


def cross_season_persistence(all_rows):
    """Link by canonical_id; does start_rate / archetype hold S -> S+1?"""
    by_canon = defaultdict(dict)
    for r in all_rows:
        by_canon[r["canonical_id"]][r["season"]] = r
    order = P.RECORDED_SEASONS
    pairs = []  # (start_rate_S, start_rate_S+1, arch_S, arch_S+1)
    for canon, seasons in by_canon.items():
        for i in range(len(order) - 1):
            a, b = seasons.get(order[i]), seasons.get(order[i + 1])
            if a and b:
                pairs.append((a["start_rate"], b["start_rate"], a["archetype"], b["archetype"]))
    rho = stats.spearman([p[0] for p in pairs], [p[1] for p in pairs]) if len(pairs) >= 20 else None
    # archetype transition matrix
    trans = defaultdict(lambda: defaultdict(int))
    for _, _, arch_s, arch_b in pairs:
        trans[arch_s][arch_b] += 1
    persist = {}
    for arch in ("nailed", "rotation", "fringe"):
        tot = sum(trans[arch].values())
        persist[arch] = {"n": tot, "stay": round(trans[arch][arch] / tot, 3) if tot else None,
                         "to": {k: v for k, v in trans[arch].items()}}
    return {"n_pairs": len(pairs),
            "start_rate_spearman_S_to_S+1": round(rho, 3) if rho is not None else None,
            "archetype_persistence": persist}


def third_archetype_evidence(all_rows):
    """Among NAILED players, is there a meaningful high-fixture-sensitivity
    subgroup (would justify a 'nailed but fixture-sensitive' 3rd archetype)?"""
    nailed = [r for r in all_rows if r["archetype"] == "nailed" and r["fixture_sensitivity"] is not None]
    if not nailed:
        return {"n": 0}
    sens = [r["fixture_sensitivity"] for r in nailed]
    return {"n_nailed_with_sens": len(nailed),
            "fixture_sensitivity_pctiles": {
                "p25": round(statistics.quantiles(sens, n=4)[0], 3),
                "p50": round(statistics.median(sens), 3),
                "p75": round(statistics.quantiles(sens, n=4)[2], 3)},
            "share_high_sens(>0.25)": round(sum(1 for s in sens if s > 0.25) / len(sens), 3),
            "note": "per-player fixture-sensitivity over ~30 games is NOISY; a wide spread "
                    "here is partly sampling. Interpret the share, not individuals."}
