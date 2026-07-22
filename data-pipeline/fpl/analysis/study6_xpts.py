"""Study 6, Phase A — the expected-points model, built and gated BEFORE ownership.

Undervaluation is a MULTI-WEEK HOLD decision, so the gate is at HORIZON: predict
CUMULATIVE points over t+1..t+n from info as-of t, walk-forward, vs naive
baselines. (The earlier single-GW gate measured the wrong thing — it buries the
fixture signal, which Study 3 proved is flat+strong only at horizon.)

Signals (all as-of the decision point t; the fixture feature spans the horizon):
  - rel_elo   : MEAN fixture-adjusted relative ELO over t+1..t+n — own rating
                as-of t minus each SCHEDULED opponent's rating as-of t. This is
                the long-horizon anchor (Study 3 R1: flat + strong).
  - form4     : last-4 ppg as-of t (enters the regression → PARTIAL weight)
  - base_ppg  : season-to-date mean points as-of t (the naive baseline + a feature)
  - start_prob: fraction of last 6 GWs started (per-player minutes persistence)
  - interact  : start_prob * rel_elo  (nailed-ness × team strength, Study 5)

GKP uses the base_ppg fallback (features add noise for keepers — honest model,
not a patch). Baselines: season-to-date ppg AND points-per-million (PPM).
Evaluation: season-level walk-forward, out-of-sample, Spearman vs cumulative
target. Reports each horizon n.
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

def assemble_features(client, season, horizon: int):
    """Decision point t; features as-of t; target = cumulative points t+1..t+n."""
    players = {p["id"]: p["position"] for p in query.fetch_all(
        client, "players", "id, position", filters={"season_id": season})}
    fixtures = query.fetch_all(client, "fixtures",
        "id, gw_number, home_team_id, away_team_id", filters={"season_id": season})
    fx = {f["id"]: f for f in fixtures}
    opps = defaultdict(list)
    for f in fixtures:
        opps[(f["home_team_id"], f["gw_number"])].append(f["away_team_id"])
        opps[(f["away_team_id"], f["gw_number"])].append(f["home_team_id"])
    max_gw = max((f["gw_number"] for f in fixtures), default=38)
    elo = {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}
    pform = {(r["player_id"], r["as_of_gw"]): r["points_per_game"] for r in query.fetch_all(
        client, "player_form", "player_id, as_of_gw, points_per_game, window_games",
        filters={"season_id": season, "window_games": 4})}

    byp = defaultdict(dict)
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, minutes, total_points, value",
            filters={"season_id": season}):
        f = fx.get(r["fixture_id"])
        if f is None or r["was_home"] is None:
            continue
        g = byp[r["player_id"]].setdefault(r["gw_number"],
                                           {"pts": 0, "min": 0, "team": None, "val": None})
        g["pts"] += r["total_points"] or 0
        g["min"] += r["minutes"] or 0
        g["team"] = f["home_team_id"] if r["was_home"] else f["away_team_id"]
        if r["value"] is not None:
            g["val"] = float(r["value"])

    rows = []
    for pid, gwmap in byp.items():
        pos = players.get(pid)
        if pos is None:
            continue
        gws = sorted(gwmap)
        for t in gws:
            if t < MIN_GW or t + horizon > max_gw:
                continue
            prior = [gwmap[g] for g in gws if g <= t]
            if len(prior) < 3:
                continue
            team = gwmap[t]["team"]
            own = elo.get((team, t))
            if own is None:
                continue
            # mean fixture-adjusted rel-ELO over the horizon (ratings frozen at t)
            diffs = []
            for g in range(t + 1, t + horizon + 1):
                for o in opps.get((team, g), []):
                    oe = elo.get((o, t))
                    if oe is not None:
                        diffs.append(own - oe)
            if not diffs:
                continue
            rel_elo = statistics.mean(diffs)
            base_ppg = statistics.mean([p["pts"] for p in prior])
            last6 = [gwmap[g] for g in gws if t - 5 <= g <= t]
            start_prob = (sum(1 for p in last6 if p["min"] >= STARTER_MIN) / len(last6)
                          if last6 else 0.0)
            form4 = pform.get((pid, t), base_ppg)
            price = gwmap[t]["val"]
            target = sum(gwmap.get(g, {}).get("pts", 0) for g in range(t + 1, t + horizon + 1))
            rows.append({
                "season": season, "player_id": pid, "pos": pos, "gw": t,
                "target": target,
                "rel_elo": rel_elo, "form4": float(form4), "base_ppg": base_ppg,
                "start_prob": start_prob, "interact": start_prob * rel_elo,
                "ppm": (base_ppg / price) if price else None,
            })
    return rows


def walk_forward_eval(client, horizon: int):
    """Fit on all seasons before S, predict cumulative t+1..t+horizon in S.
    GKP uses base_ppg fallback. Baselines: season-to-date ppg AND PPM."""
    per_season = {s: assemble_features(client, s, horizon) for s in P.RECORDED_SEASONS}
    mae = lambda a, b: statistics.mean(abs(a[j] - b[j]) for j in range(len(a)))
    results = {}
    for i, test in enumerate(P.RECORDED_SEASONS):
        if i == 0:
            continue
        train = [r for s in P.RECORDED_SEASONS[:i] for r in per_season[s]]
        results[test] = {}
        for pos in POSITIONS:
            tr = [r for r in train if r["pos"] == pos]
            te = [r for r in per_season[test] if r["pos"] == pos]
            if len(tr) < 200 or len(te) < 50:
                results[test][pos] = None
                continue
            actual = [r["target"] for r in te]
            base = [r["base_ppg"] for r in te]
            ppm_pairs = [(r["ppm"], r["target"]) for r in te if r["ppm"] is not None]
            if pos == "GKP":            # honest fallback — features add noise for keepers
                preds = base
                coefs = None
            else:
                coefs = _ols_fit([[r[f] for f in FEATURES] for r in tr], [r["target"] for r in tr])
                preds = [_predict(coefs, [r[f] for f in FEATURES]) for r in te]
            results[test][pos] = {
                "n": len(te),
                "xpts_spearman": round(stats.spearman(preds, actual), 3),
                "base_spearman": round(stats.spearman(base, actual), 3),
                "ppm_spearman": (round(stats.spearman([p[0] for p in ppm_pairs],
                                 [p[1] for p in ppm_pairs]), 3) if len(ppm_pairs) > 50 else None),
                "gkp_fallback": pos == "GKP",
                "coefs": ({f: round(coefs[j + 1], 4) for j, f in enumerate(FEATURES)}
                          if coefs else "base_ppg fallback"),
            }
    return results, per_season
