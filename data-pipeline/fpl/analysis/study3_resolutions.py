"""Study 3 follow-ups (pre-Study-4):

R1. ELO construct: re-measure decay with FIXTURE-ADJUSTED relative ELO — own ELO
    as-of t minus the SCHEDULED opponent's ELO as-of t (opponent known from the
    published fixture list, ratings frozen at t). Walk-forward, uses the schedule.
R2. Form vs minutes-in-disguise: partial correlation of form~future-points
    controlling for BOTH the player's own baseline AND recent (last-4) minutes.
"""
from __future__ import annotations

import math
import statistics
from collections import defaultdict

from ingest import query
from analysis import stats
from analysis import study3_decay as D
from analysis import params as P

HORIZONS = D.HORIZONS
STARTER_MIN = D.STARTER_MIN
POSITIONS = D.POSITIONS


# ── R1: fixture-adjusted relative ELO ────────────────────────────────────────

def _team_opponents(client, season):
    """{(team_id, gw) -> [opponent_team_id ...]} (0 for blanks, 2 for doubles)."""
    opps = defaultdict(list)
    for f in query.fetch_all(client, "fixtures",
            "gw_number, home_team_id, away_team_id", filters={"season_id": season}):
        opps[(f["home_team_id"], f["gw_number"])].append(f["away_team_id"])
        opps[(f["away_team_id"], f["gw_number"])].append(f["home_team_id"])
    return opps


def _elo_at(client, season):
    return {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}


def fixture_relative_decay(client, cumulative=True):
    """Spearman(mean fixture-adjusted relative ELO over the horizon [known at t],
    points over that horizon) per position per n."""
    seasons_data = []
    for s in P.RECORDED_SEASONS:
        tl, max_gw = D.build_timeline(client, s)
        seasons_data.append((tl, max_gw, _team_opponents(client, s), _elo_at(client, s)))

    curves = {pos: {} for pos in POSITIONS}
    for n in HORIZONS:
        buck = {pos: ([], []) for pos in POSITIONS}
        for tl, max_gw, opps, elo in seasons_data:
            for byg in tl.values():
                for t, rec in byg.items():
                    if rec["pos"] not in POSITIONS or rec["minutes"] < STARTER_MIN:
                        continue
                    team = rec["team_id"]
                    own = elo.get((team, t))
                    if own is None or t + n > max_gw:
                        continue
                    # fixture-adjusted relative ELO over the window (ratings frozen at t)
                    diffs = []
                    gw_range = range(t + n, t + n + 1) if not cumulative else range(t + 1, t + n + 1)
                    for g in gw_range:
                        for opp in opps.get((team, g), []):
                            oe = elo.get((opp, t))
                            if oe is not None:
                                diffs.append(own - oe)
                    if not diffs:
                        continue
                    factor = statistics.mean(diffs)
                    if cumulative:
                        tgt = D._cum_points(byg, t, n, max_gw)
                    else:
                        tgt = byg.get(t + n, {}).get("points") if t + n <= max_gw else None
                    if tgt is None:
                        continue
                    xs, ys = buck[rec["pos"]]
                    xs.append(factor); ys.append(float(tgt))
        for pos in POSITIONS:
            xs, ys = buck[pos]
            curves[pos][n] = stats.spearman_full(xs, ys)
    return curves


# ── R2: multiple partial correlation (2 controls, rank-based) ────────────────

def _ols2_resid(y, x1, x2):
    """Residuals of y ~ 1 + x1 + x2 (normal equations)."""
    n = len(y)
    sx1 = sum(x1); sx2 = sum(x2)
    s11 = sum(a * a for a in x1); s22 = sum(a * a for a in x2)
    s12 = sum(x1[i] * x2[i] for i in range(n))
    sy = sum(y); sy1 = sum(y[i] * x1[i] for i in range(n)); sy2 = sum(y[i] * x2[i] for i in range(n))
    # 3x3 system [n sx1 sx2; sx1 s11 s12; sx2 s12 s22] [b0 b1 b2] = [sy sy1 sy2]
    import itertools
    A = [[n, sx1, sx2], [sx1, s11, s12], [sx2, s12, s22]]
    b = [sy, sy1, sy2]
    # Gaussian elimination
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(3):
        piv = max(range(col, 3), key=lambda r: abs(M[r][col]))
        M[col], M[piv] = M[piv], M[col]
        if abs(M[col][col]) < 1e-12:
            return None
        for r in range(3):
            if r != col:
                f = M[r][col] / M[col][col]
                M[r] = [M[r][k] - f * M[col][k] for k in range(4)]
    coef = [M[i][3] / M[i][i] for i in range(3)]
    return [y[i] - (coef[0] + coef[1] * x1[i] + coef[2] * x2[i]) for i in range(n)]


def form_partial_two_controls(client):
    """Partial Spearman(form, future cum points | baseline_points, recent_minutes)."""
    seasons = [D.build_timeline(client, s) for s in P.RECORDED_SEASONS]
    out = {pos: {} for pos in POSITIONS}
    for n in HORIZONS:
        buck = {pos: {"form": [], "base": [], "mins": [], "tgt": []} for pos in POSITIONS}
        for tl, max_gw in seasons:
            for byg in tl.values():
                if not byg:
                    continue
                gws = sorted(byg)
                for t in gws:
                    rec = byg[t]
                    if rec["minutes"] < STARTER_MIN or rec["form4_t"] is None:
                        continue
                    prior_pts = [byg[g]["points"] for g in gws if g <= t - 4 and byg[g]["minutes"] >= 1]
                    recent_min = [byg[g]["minutes"] for g in gws if t - 3 <= g <= t]
                    if len(prior_pts) < 2 or not recent_min:
                        continue
                    tgt = D._cum_points(byg, t, n, max_gw)
                    if tgt is None:
                        continue
                    b = buck[rec["pos"]]
                    b["form"].append(float(rec["form4_t"]))
                    b["base"].append(statistics.mean(prior_pts))
                    b["mins"].append(statistics.mean(recent_min))
                    b["tgt"].append(float(tgt))
        for pos in POSITIONS:
            b = buck[pos]
            nrows = len(b["tgt"])
            if nrows < 30:
                out[pos][n] = {"raw": None, "partial_2ctrl": None, "n": nrows}
                continue
            rform, rbase, rmin, rtgt = (stats._rank(b["form"]), stats._rank(b["base"]),
                                        stats._rank(b["mins"]), stats._rank(b["tgt"]))
            raw = stats.spearman(b["form"], b["tgt"])
            ef = _ols2_resid(rform, rbase, rmin)
            et = _ols2_resid(rtgt, rbase, rmin)
            if ef is None or et is None:
                partial = None
            else:
                mf, mt = sum(ef) / nrows, sum(et) / nrows
                cov = sum((ef[i] - mf) * (et[i] - mt) for i in range(nrows))
                sf = math.sqrt(sum((e - mf) ** 2 for e in ef))
                st = math.sqrt(sum((e - mt) ** 2 for e in et))
                partial = round(cov / (sf * st), 3) if sf and st else None
            # also minutes-alone → target, for context
            r_min_tgt = stats.spearman(b["mins"], b["tgt"])
            out[pos][n] = {"raw": round(raw, 3), "partial_2ctrl": partial,
                           "minutes_alone": round(r_min_tgt, 3), "n": nrows}
    return out
