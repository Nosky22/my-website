"""Study 6, Phase A — the expected-points model, built and gated BEFORE ownership.

Undervaluation = xPts net of ownership, so xPts is the whole ballgame. This
builds a SIMPLE, INTERPRETABLE, LINEAR xPts from the calibrated signals and
reports its OUT-OF-SAMPLE accuracy vs the naive baseline (season-to-date ppg)
BEFORE any ownership term. If xPts doesn't beat the baseline, everything
downstream is built on sand — stop and report.

Signals (all walk-forward, known before the GW):
  - rel_elo   : fixture-adjusted relative ELO (own@gw-1 - scheduled opp@gw-1)
  - form4     : last-4 ppg entering the GW  (enters the regression → gets its
                PARTIAL weight automatically alongside minutes/baseline)
  - base_ppg  : season-to-date mean points (the baseline, also a feature)
  - start_prob: fraction of last 6 GWs started (per-player minutes persistence)
  - interact  : start_prob * rel_elo  (nailed-ness × team strength, Study 5)

Evaluation: season-level WALK-FORWARD — fit on all seasons before the test
season, predict every player-GW in it, score out-of-sample. Metrics per
position: Spearman(pred, actual) and MAE, vs the season-to-date-ppg baseline.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from ingest import query
from analysis import stats
from analysis import params as P

STARTER_MIN = 60
MIN_GW = 6                 # need history for base_ppg / start_prob
FEATURES = ("rel_elo", "form4", "base_ppg", "start_prob", "interact")
POSITIONS = ("GKP", "DEF", "MID", "FWD")


# ── pure-Python OLS with intercept ───────────────────────────────────────────

def _ols_fit(X, y):
    """X: list of feature-rows (len k). Returns coefs [b0, b1..bk] (b0=intercept)."""
    k = len(X[0])
    # design with intercept
    rows = [[1.0] + list(x) for x in X]
    m = k + 1
    XtX = [[0.0] * m for _ in range(m)]
    Xty = [0.0] * m
    for i, r in enumerate(rows):
        yi = y[i]
        for a in range(m):
            Xty[a] += r[a] * yi
            for b in range(m):
                XtX[a][b] += r[a] * r[b]
    # solve XtX b = Xty (Gaussian elimination w/ partial pivot + tiny ridge)
    for a in range(m):
        XtX[a][a] += 1e-6
    M = [XtX[i][:] + [Xty[i]] for i in range(m)]
    for col in range(m):
        piv = max(range(col, m), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        if abs(M[col][col]) < 1e-12:
            return None
        for r in range(m):
            if r != col:
                f = M[r][col] / M[col][col]
                M[r] = [M[r][j] - f * M[col][j] for j in range(m + 1)]
    return [M[i][m] / M[i][i] for i in range(m)]


def _predict(coefs, x):
    return coefs[0] + sum(coefs[i + 1] * x[i] for i in range(len(x)))


# ── feature assembly (walk-forward) ──────────────────────────────────────────

def assemble_features(client, season):
    players = {p["id"]: p["position"] for p in query.fetch_all(
        client, "players", "id, position", filters={"season_id": season})}
    fixtures = query.fetch_all(client, "fixtures",
        "id, gw_number, home_team_id, away_team_id", filters={"season_id": season})
    fx = {f["id"]: f for f in fixtures}
    opps = defaultdict(list)
    for f in fixtures:
        opps[(f["home_team_id"], f["gw_number"])].append(f["away_team_id"])
        opps[(f["away_team_id"], f["gw_number"])].append(f["home_team_id"])
    elo = {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}
    pform = {(r["player_id"], r["as_of_gw"]): r["points_per_game"] for r in query.fetch_all(
        client, "player_form", "player_id, as_of_gw, points_per_game, window_games",
        filters={"season_id": season, "window_games": 4})}

    # aggregate per (player, gw)
    byp = defaultdict(dict)
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, minutes, total_points",
            filters={"season_id": season}):
        f = fx.get(r["fixture_id"])
        if f is None or r["was_home"] is None:
            continue
        g = byp[r["player_id"]].setdefault(r["gw_number"],
                                           {"pts": 0, "min": 0, "team": None})
        g["pts"] += r["total_points"] or 0
        g["min"] += r["minutes"] or 0
        g["team"] = f["home_team_id"] if r["was_home"] else f["away_team_id"]

    rows = []
    for pid, gwmap in byp.items():
        pos = players.get(pid)
        if pos is None:
            continue
        gws = sorted(gwmap)
        for gw in gws:
            if gw < MIN_GW:
                continue
            prior = [gwmap[g] for g in gws if g < gw]
            if len(prior) < 3:
                continue
            team = gwmap[gw]["team"]
            own = elo.get((team, gw - 1))
            opp_ids = opps.get((team, gw), [])
            opp_elos = [elo.get((o, gw - 1)) for o in opp_ids]
            opp_elos = [e for e in opp_elos if e is not None]
            if own is None or not opp_elos:
                continue
            rel_elo = own - statistics.mean(opp_elos)
            base_ppg = statistics.mean([p["pts"] for p in prior])
            last6 = [gwmap[g] for g in gws if gw - 6 <= g < gw]
            start_prob = (sum(1 for p in last6 if p["min"] >= STARTER_MIN) / len(last6)
                          if last6 else 0.0)
            form4 = pform.get((pid, gw - 1), base_ppg)
            rows.append({
                "season": season, "player_id": pid, "pos": pos, "gw": gw,
                "target": gwmap[gw]["pts"],
                "rel_elo": rel_elo, "form4": float(form4), "base_ppg": base_ppg,
                "start_prob": start_prob, "interact": start_prob * rel_elo,
            })
    return rows


def walk_forward_eval(client):
    """Fit on all seasons before S, predict S; report per position vs baseline."""
    per_season = {s: assemble_features(client, s) for s in P.RECORDED_SEASONS}
    results = {}
    for i, test in enumerate(P.RECORDED_SEASONS):
        if i == 0:
            continue  # no prior data to train on
        train = [r for s in P.RECORDED_SEASONS[:i] for r in per_season[s]]
        results[test] = {}
        for pos in POSITIONS:
            tr = [r for r in train if r["pos"] == pos]
            te = [r for r in per_season[test] if r["pos"] == pos]
            if len(tr) < 200 or len(te) < 50:
                results[test][pos] = None
                continue
            coefs = _ols_fit([[r[f] for f in FEATURES] for r in tr], [r["target"] for r in tr])
            preds = [_predict(coefs, [r[f] for f in FEATURES]) for r in te]
            actual = [r["target"] for r in te]
            base = [r["base_ppg"] for r in te]  # naive baseline
            mae = lambda a, b: statistics.mean(abs(a[j] - b[j]) for j in range(len(a)))
            results[test][pos] = {
                "n": len(te),
                "xpts_spearman": round(stats.spearman(preds, actual), 3),
                "base_spearman": round(stats.spearman(base, actual), 3),
                "xpts_mae": round(mae(preds, actual), 3),
                "base_mae": round(mae(base, actual), 3),
                "coefs": {f: round(coefs[j + 1], 4) for j, f in enumerate(FEATURES)},
            }
    return results, per_season
