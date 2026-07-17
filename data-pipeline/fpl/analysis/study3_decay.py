"""Study 3 — noise ceiling + per-factor prediction decay (§5.5d).

Design steers (from review):
  1. NOISE CEILING FIRST. Single-GW points are hugely noisy; a raw rho of 0.28
     may be most of the achievable signal. Estimate the ceiling (ICC-based +
     split-half) and re-express Study 2 effects as a fraction of it.
  2. Decay measured vs CUMULATIVE points over t+1..t+n (what planning cares
     about), not single-GW. Single-GW reported as secondary.
  3. Player form: the deferred control — does last-4 form predict BEYOND the
     player's own season-to-date-EXCLUDING-last-4 baseline (walk-forward)?
  4. Minutes persistence is a first-class curve ("still starting in n weeks?").
  5. Skip team form (#5) — null at horizon 1, a decay curve is pointless.
  6. Fixture cluster (#1/#2/#3/#4/#9) = ONE curve via ELO; others are views.
"""
from __future__ import annotations

import logging
import math
import statistics
from collections import defaultdict

from ingest import query
from analysis import stats
from analysis import params as P

log = logging.getLogger(__name__)

STARTER_MIN = 60
POSITIONS = ("GKP", "DEF", "MID", "FWD")
HORIZONS = (1, 2, 3, 4, 6, 8, 10)


# ── Timeline: per (player, gw) aggregated, with factor values AT t ───────────

def build_timeline(client, season: str):
    players = {p["id"]: p["position"] for p in query.fetch_all(
        client, "players", "id, position", filters={"season_id": season})}
    fixtures = {f["id"]: f for f in query.fetch_all(client, "fixtures",
                "id, gw_number, home_team_id, away_team_id", filters={"season_id": season})}
    elo = {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}
    pform = {(r["player_id"], r["as_of_gw"]): r["points_per_game"] for r in query.fetch_all(
        client, "player_form", "player_id, as_of_gw, points_per_game, window_games",
        filters={"season_id": season, "window_games": 4})}

    # aggregate player_gameweeks per (player, gw)
    agg = defaultdict(lambda: {"points": 0, "minutes": 0, "team_id": None,
                               "value": None, "selected_by": None})
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, minutes, total_points, value, selected_by",
            filters={"season_id": season}):
        f = fixtures.get(r["fixture_id"])
        if f is None or r["was_home"] is None:
            continue
        a = agg[(r["player_id"], r["gw_number"])]
        a["points"] += r["total_points"] or 0
        a["minutes"] += r["minutes"] or 0
        a["team_id"] = f["home_team_id"] if r["was_home"] else f["away_team_id"]
        if r["value"] is not None:
            a["value"] = float(r["value"])
        if r["selected_by"] is not None:
            a["selected_by"] = float(r["selected_by"])

    tl = defaultdict(dict)  # player_id -> {gw -> record}
    for (pid, gw), a in agg.items():
        tl[pid][gw] = {
            "pos": players.get(pid), "points": a["points"], "minutes": a["minutes"],
            "elo_t": elo.get((a["team_id"], gw)),           # strength known at t (<= t)
            "form4_t": pform.get((pid, gw)),                 # last-4 form as-of t
            "value": a["value"], "selected_by": a["selected_by"],
        }
    max_gw = max((f["gw_number"] for f in fixtures.values()), default=38)
    return tl, max_gw


def _cum_points(rec_by_gw, t, n, max_gw):
    """Total points over GWs t+1..t+n (0 for GWs the player didn't feature)."""
    if t + n > max_gw:
        return None
    return sum(rec_by_gw.get(g, {}).get("points", 0) for g in range(t + 1, t + n + 1))


def _cum_minutes(rec_by_gw, t, n, max_gw):
    if t + n > max_gw:
        return None
    return sum(rec_by_gw.get(g, {}).get("minutes", 0) for g in range(t + 1, t + n + 1))


# ── 1. Noise ceiling ─────────────────────────────────────────────────────────

def noise_ceiling(timelines) -> dict:
    """Per position: ICC of single-GW starter points → ceiling rho = sqrt(ICC);
    plus odd/even split-half of per-player mean points as a cross-check."""
    out = {}
    for pos in POSITIONS:
        # groups = player-seasons; observations = starter single-GW points
        groups = []
        for tl in timelines:
            for pid, byg in tl.items():
                pts = [r["points"] for r in byg.values()
                       if r["pos"] == pos and r["minutes"] >= STARTER_MIN]
                if len(pts) >= 5:
                    groups.append(pts)
        if len(groups) < 10:
            out[pos] = {"icc": None, "ceiling_rho": None, "n_players": len(groups)}
            continue
        all_obs = [x for g in groups for x in g]
        N = len(all_obs)
        k = len(groups)
        grand = sum(all_obs) / N
        ms_between = sum(len(g) * (statistics.mean(g) - grand) ** 2 for g in groups) / (k - 1)
        ms_within = sum(sum((x - statistics.mean(g)) ** 2 for x in g) for g in groups) / (N - k)
        n0 = (N - sum(len(g) ** 2 for g in groups) / N) / (k - 1)
        icc = (ms_between - ms_within) / (ms_between + (n0 - 1) * ms_within) if (ms_between + (n0 - 1) * ms_within) else 0.0
        icc = max(0.0, icc)
        # split-half odd/even of per-player mean
        odd, even = [], []
        for g in groups:
            o = g[0::2]; e = g[1::2]
            if o and e:
                odd.append(statistics.mean(o)); even.append(statistics.mean(e))
        r_split = stats.spearman(odd, even) if len(odd) >= 10 else float("nan")
        out[pos] = {
            "icc": round(icc, 3),
            "ceiling_rho": round(math.sqrt(icc), 3),
            "split_half_oddeven_rho": None if math.isnan(r_split) else round(r_split, 3),
            "n_players": k, "n_obs": N,
            "note": ("ceiling_rho = sqrt(ICC) = max corr any predictor of a player's "
                     "true rate can have with realised single-GW points. This is a "
                     "LOWER bound on the achievable ceiling — fixture/home context adds "
                     "further predictable variance a full model could exploit."),
        }
    return out


# ── 2. Decay curves ──────────────────────────────────────────────────────────

def decay_curve(timelines, factor_key, positions=POSITIONS, cumulative=True):
    """Spearman(factor at t, cumulative[or single] points t+1..t+n) per pos per n.
    factor observed on STARTERS at t (they must be evaluable)."""
    curves = {pos: {} for pos in positions}
    for n in HORIZONS:
        buckets = {pos: ([], []) for pos in positions}
        for tl in timelines:
            for byg in tl.values():
                max_gw = max(byg) if byg else 0
                for t, rec in byg.items():
                    if rec["pos"] not in positions or rec["minutes"] < STARTER_MIN:
                        continue
                    fv = rec.get(factor_key)
                    if fv is None:
                        continue
                    tgt = (_cum_points(byg, t, n, max_gw) if cumulative
                           else byg.get(t + n, {}).get("points") if t + n <= max_gw else None)
                    if tgt is None:
                        continue
                    xs, ys = buckets[rec["pos"]]
                    xs.append(float(fv)); ys.append(float(tgt))
        for pos in positions:
            xs, ys = buckets[pos]
            c = stats.spearman_full(xs, ys)
            c["thin"] = c["n"] < stats.THIN_CELL
            curves[pos][n] = c
    return curves


# ── 3. Player-form control (does form add beyond own baseline?) ──────────────

def player_form_controlled(timelines):
    """At t: form4_t vs cumulative future points, controlling for the player's
    season-to-date-EXCLUDING-last-4 baseline (walk-forward). Reports raw and
    partial per horizon per position."""
    out = {pos: {} for pos in POSITIONS}
    for n in HORIZONS:
        buck = {pos: {"form": [], "base": [], "tgt": []} for pos in POSITIONS}
        for tl in timelines:
            for byg in tl.values():
                if not byg:
                    continue
                max_gw = max(byg)
                gws = sorted(byg)
                for t in gws:
                    rec = byg[t]
                    if rec["minutes"] < STARTER_MIN or rec["form4_t"] is None:
                        continue
                    # baseline = mean points over appearances in GWs <= t-4
                    prior = [byg[g]["points"] for g in gws if g <= t - 4 and byg[g]["minutes"] >= 1]
                    if len(prior) < 2:
                        continue
                    tgt = _cum_points(byg, t, n, max_gw)
                    if tgt is None:
                        continue
                    b = buck[rec["pos"]]
                    b["form"].append(float(rec["form4_t"]))
                    b["base"].append(statistics.mean(prior))
                    b["tgt"].append(float(tgt))
        for pos in POSITIONS:
            b = buck[pos]
            nrows = len(b["tgt"])
            if nrows < 20:
                out[pos][n] = {"raw": None, "partial": None, "n": nrows}
                continue
            raw = stats.spearman(b["form"], b["tgt"])
            # partial(form, tgt | base) via rank residualisation
            r_ft = raw
            r_fb = stats.spearman(b["form"], b["base"])
            r_bt = stats.spearman(b["base"], b["tgt"])
            denom = math.sqrt((1 - r_fb ** 2) * (1 - r_bt ** 2))
            partial = (r_ft - r_fb * r_bt) / denom if denom else float("nan")
            out[pos][n] = {
                "raw": round(raw, 3),
                "partial_controlling_baseline": None if math.isnan(partial) else round(partial, 3),
                "baseline_alone": round(r_bt, 3),
                "n": nrows,
            }
    return out


# ── 4. Minutes persistence ───────────────────────────────────────────────────

def minutes_persistence(timelines):
    """For players starting at t: P(still starting at t+n), and Spearman(minutes_t,
    cumulative minutes t+1..t+n). The central planning curve."""
    out = {pos: {} for pos in POSITIONS}
    for n in HORIZONS:
        buck = {pos: {"stay": 0, "total": 0, "mt": [], "cum": []} for pos in POSITIONS}
        for tl in timelines:
            for byg in tl.values():
                if not byg:
                    continue
                max_gw = max(byg)
                for t, rec in byg.items():
                    if rec["minutes"] < STARTER_MIN or rec["pos"] not in POSITIONS:
                        continue
                    if t + n > max_gw:
                        continue
                    b = buck[rec["pos"]]
                    fut = byg.get(t + n, {})
                    b["total"] += 1
                    if fut.get("minutes", 0) >= STARTER_MIN:
                        b["stay"] += 1
                    b["mt"].append(rec["minutes"])
                    b["cum"].append(_cum_minutes(byg, t, n, max_gw))
        for pos in POSITIONS:
            b = buck[pos]
            if b["total"] < 20:
                out[pos][n] = {"p_still_starting": None, "n": b["total"]}
                continue
            out[pos][n] = {
                "p_still_starting": round(b["stay"] / b["total"], 3),
                "spearman_minutes_t_vs_cum": stats.spearman_full(b["mt"], b["cum"])["rho"],
                "n": b["total"],
            }
    return out
