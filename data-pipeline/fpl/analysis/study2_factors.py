"""Study 2 — factor-correlation study (§5.5c).

Measures, PER POSITION, how strongly each of 11 factors relates to a player's
points. Walk-forward: every stateful factor (ELO, form) uses its value ENTERING
the gameweek (as-of t-1), never the target GW. Minutes is the dominant gate
(62% of rows are 0-minute), so factors #1-9,11 are measured on STARTERS
(minutes >= 60) to isolate "return given playing"; #10 (minutes) is measured
across all rows to quantify the gate itself.

Honesty requirements enforced here:
  - every cell reports rho, N, and a 95% CI (thin cells → wide bars, flagged).
  - ownership (#8) & price (#7): reverse-causation. Ownership/price at t partly
    REFLECT prior performance. #8 reported BOTH contemporaneous and predictive
    (t vs t+1) so the lagging gap is visible; #7 flagged as lagging.
  - home/away-sensitive factors (#2) reported WITH and WITHOUT 2020/21 (COVID,
    behind closed doors).
  - factors confounded with each other are named as such, not sold as independent.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from ingest import load, query
from analysis import stats
from analysis import params as P

log = logging.getLogger(__name__)

STARTER_MIN = 60
POSITIONS = ("GKP", "DEF", "MID", "FWD")
ATTACK_POS = {"MID", "FWD"}       # judged on opponent DEFENCE
DEFEND_POS = {"GKP", "DEF"}       # judged on opponent ATTACK


# ── Assembly: one walk-forward row per (player, fixture) ─────────────────────

def _assemble(client, season: str) -> list[dict]:
    players = {p["id"]: p for p in query.fetch_all(client, "players",
               "id, position, team_id", filters={"season_id": season})}
    fixtures = {f["id"]: f for f in query.fetch_all(client, "fixtures",
                "id, gw_number, home_team_id, away_team_id, home_difficulty, away_difficulty",
                filters={"season_id": season})}
    teams = {t["id"]: t for t in query.fetch_all(client, "teams",
             "id, strength_attack_home, strength_attack_away, strength_defence_home, "
             "strength_defence_away", filters={"season_id": season})}
    elo = {(r["team_id"], r["gw_number"]): float(r["elo"]) for r in query.fetch_all(
        client, "team_elo", "team_id, gw_number, elo", filters={"season_id": season})}
    tform = {(r["team_id"], r["as_of_gw"]): r["points"] for r in query.fetch_all(
        client, "team_form", "team_id, as_of_gw, points, window_games",
        filters={"season_id": season, "window_games": 6})}
    pform = {(r["player_id"], r["as_of_gw"]): r["points_per_game"] for r in query.fetch_all(
        client, "player_form", "player_id, as_of_gw, points_per_game, window_games",
        filters={"season_id": season, "window_games": 4})}

    rows = []
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, opponent_team_id, was_home, minutes, "
            "total_points, value, selected_by", filters={"season_id": season}):
        p = players.get(r["player_id"])
        f = fixtures.get(r["fixture_id"])
        if not p or not f or r["was_home"] is None:
            continue
        gw = r["gw_number"]
        home = r["was_home"]
        team_id = f["home_team_id"] if home else f["away_team_id"]
        opp_id = r["opponent_team_id"]
        opp = teams.get(opp_id)
        fdr = f["home_difficulty"] if home else f["away_difficulty"]
        # opponent facet strength on the side they play (player home → opp away)
        opp_def = (opp["strength_defence_away"] if home else opp["strength_defence_home"]) if opp else None
        opp_att = (opp["strength_attack_away"] if home else opp["strength_attack_home"]) if opp else None
        own = teams.get(team_id)
        own_def = (own["strength_defence_home"] if home else own["strength_defence_away"]) if own else None
        own_att = (own["strength_attack_home"] if home else own["strength_attack_away"]) if own else None
        rows.append({
            "season": season, "player_id": r["player_id"], "pos": p["position"],
            "gw": gw, "points": r["total_points"] or 0, "minutes": r["minutes"] or 0,
            "home": home, "fdr": fdr,
            "elo_pre": elo.get((team_id, gw - 1)),
            "opp_elo_pre": elo.get((opp_id, gw - 1)),
            "opp_def": opp_def, "opp_att": opp_att,
            "own_def": own_def, "own_att": own_att,
            "tform_pre": tform.get((team_id, gw - 1)),
            "pform_pre": pform.get((r["player_id"], gw - 1)),
            "value": float(r["value"]) if r["value"] is not None else None,
            "selected_by": float(r["selected_by"]) if r["selected_by"] is not None else None,
        })
    return rows


def _starters(rows):
    return [r for r in rows if r["minutes"] >= STARTER_MIN]


def _by_pos(rows):
    d = defaultdict(list)
    for r in rows:
        d[r["pos"]].append(r)
    return d


def _corr_by_pos(rows, xkey, ykey="points", positions=POSITIONS):
    """Spearman(x, points) per position over rows with non-null x."""
    out = {}
    bypos = _by_pos(rows)
    for pos in positions:
        pr = [r for r in bypos.get(pos, []) if r.get(xkey) is not None]
        xs = [float(r[xkey]) for r in pr]
        ys = [float(r[ykey]) for r in pr]
        cell = stats.spearman_full(xs, ys)
        cell["thin"] = cell["n"] < stats.THIN_CELL
        out[pos] = cell
    return out


# ── Factors ──────────────────────────────────────────────────────────────────

def factor_01_fdr(all_rows):
    """Per-season (FDR scale changed across seasons: 2-4 / 2-5 / 1-4)."""
    per_season = {}
    for s in P.RECORDED_SEASONS:
        rows = _starters([r for r in all_rows if r["season"] == s])
        per_season[s] = _corr_by_pos(rows, "fdr")
    return {"note": "Spearman(FDR, points); negative = harder fixture, fewer points. "
                    "Per-season because the FDR scale is not comparable across seasons.",
            "per_season": per_season}


def factor_02_home_away(all_rows):
    """Home vs away mean points; WITH and WITHOUT 2020/21 (COVID/BCD)."""
    def compute(rows):
        out = {}
        for pos, pr in _by_pos(_starters(rows)).items():
            home = [r["points"] for r in pr if r["home"]]
            away = [r["points"] for r in pr if not r["home"]]
            out[pos] = stats.mean_diff(home, away)  # delta = home - away
        return out
    return {"note": "mean points home vs away (delta = home - away), starters only.",
            "with_2020_21": compute(all_rows),
            "without_2020_21": compute([r for r in all_rows if r["season"] != "2020-21"])}


def factor_03_relative_elo(all_rows):
    rows = [r for r in _starters(all_rows) if r["elo_pre"] and r["opp_elo_pre"]]
    for r in rows:
        r["rel_elo"] = r["elo_pre"] - r["opp_elo_pre"]
    return {"note": "Spearman(own ELO - opp ELO entering GW, points). Walk-forward "
                    "(ratings as-of t-1); GW1 excluded (no pre-match rating). "
                    "Sharper than FDR; confounded with home/away via HFA.",
            "all": _corr_by_pos(rows, "rel_elo"),
            "without_2020_21": _corr_by_pos([r for r in rows if r["season"] != "2020-21"], "rel_elo")}


def factor_04_opponent_facet(all_rows):
    """Attackers judged on opp DEFENCE; defenders/GK on opp ATTACK."""
    rows = _starters(all_rows)
    att = _corr_by_pos([r for r in rows if r["pos"] in ATTACK_POS], "opp_def", positions=("MID", "FWD"))
    dfn = _corr_by_pos([r for r in rows if r["pos"] in DEFEND_POS], "opp_att", positions=("GKP", "DEF"))
    return {"note": "Attackers (MID/FWD) vs opponent DEFENCE strength; defenders/GK "
                    "(GKP/DEF) vs opponent ATTACK strength. Negative expected. "
                    "Opponent strength = FPL static end-of-season facet rating.",
            "attackers_vs_opp_defence": att,
            "defenders_vs_opp_attack": dfn}


def _partial_spearman(rows, xkey, zkey, ykey="points"):
    """Partial Spearman of x~y controlling for z (rank-residual method)."""
    pr = [r for r in rows if r.get(xkey) is not None and r.get(zkey) is not None]
    if len(pr) < 10:
        return {"rho": None, "n": len(pr), "ci95": [None, None]}
    rxy = stats.spearman([float(r[xkey]) for r in pr], [float(r[ykey]) for r in pr])
    rxz = stats.spearman([float(r[xkey]) for r in pr], [float(r[zkey]) for r in pr])
    rzy = stats.spearman([float(r[zkey]) for r in pr], [float(r[ykey]) for r in pr])
    denom = ((1 - rxz ** 2) * (1 - rzy ** 2)) ** 0.5
    import math
    if denom == 0 or math.isnan(denom):
        return {"rho": None, "n": len(pr), "ci95": [None, None]}
    partial = (rxy - rxz * rzy) / denom
    lo, hi = stats.spearman_ci(partial, len(pr))
    return {"rho": round(partial, 3), "n": len(pr),
            "ci95": [round(lo, 3) if lo == lo else None, round(hi, 3) if hi == hi else None]}


def factor_05_team_form_beyond_baseline(all_rows):
    """Does recent team form add signal BEYOND baseline team strength (ELO)?"""
    rows = [r for r in _starters(all_rows) if r["tform_pre"] is not None and r["elo_pre"]]
    raw = _corr_by_pos(rows, "tform_pre")
    partial = {pos: _partial_spearman([r for r in rows if r["pos"] == pos],
                                      "tform_pre", "elo_pre") for pos in POSITIONS}
    return {"note": "raw = Spearman(team form points last-6 entering GW, player points); "
                    "partial = same but controlling for baseline ELO. If partial ~ 0, "
                    "team form adds little beyond baseline strength (regression-to-mean).",
            "raw": raw, "partial_controlling_elo": partial}


def factor_06_player_form(all_rows):
    rows = [r for r in _starters(all_rows) if r["pform_pre"] is not None]
    return {"note": "Spearman(player points-per-game last-4 entering GW, points). "
                    "Walk-forward. Confounded with minutes/role.",
            "all": _corr_by_pos(rows, "pform_pre")}


def factor_07_price(all_rows):
    rows = [r for r in _starters(all_rows) if r["value"] is not None]
    return {"note": "Spearman(price, points). LAGGING CAVEAT: price is driven by net "
                    "transfers, which react to prior performance — price partly REFLECTS "
                    "past points rather than predicting future ones. Contemporaneous only.",
            "all": _corr_by_pos(rows, "value")}


def factor_08_ownership(all_rows):
    """2025/26 only. Contemporaneous vs PREDICTIVE (t vs t+1) to expose lag."""
    s = [r for r in all_rows if r["season"] == "2025-26" and r["selected_by"] is not None]
    starters = _starters(s)
    contemp = _corr_by_pos(starters, "selected_by")

    # predictive: ownership at t vs points at t+1 (same player)
    by_pg = {(r["player_id"], r["gw"]): r for r in s}
    pred_rows = []
    for r in starters:
        nxt = by_pg.get((r["player_id"], r["gw"] + 1))
        if nxt and nxt["minutes"] >= STARTER_MIN:
            pred_rows.append({"pos": r["pos"], "selected_by": r["selected_by"],
                              "points": nxt["points"]})
    predictive = _corr_by_pos(pred_rows, "selected_by")
    return {"note": "REVERSE-CAUSATION TRAP: ownership at t reflects managers reacting "
                    "to points up to t-1, so contemporaneous corr is partly a LAGGING "
                    "indicator. Predictive (own_t vs pts_t+1) is the market-signal "
                    "question Study 6 needs. Gap between the two = the lag. 2025/26 only "
                    "(archive seasons have null ownership).",
            "contemporaneous_t_vs_t": contemp,
            "predictive_t_vs_t+1": predictive}


def factor_09_positional_team_strength(all_rows):
    """Own team's RELEVANT facet strength by position (the sharp question)."""
    rows = _starters(all_rows)
    dfn = _corr_by_pos([r for r in rows if r["pos"] in DEFEND_POS], "own_def", positions=("GKP", "DEF"))
    att = _corr_by_pos([r for r in rows if r["pos"] in ATTACK_POS], "own_att", positions=("MID", "FWD"))
    return {"note": "Own team strength measured PER POSITION: defenders/GK vs own DEFENCE "
                    "strength, attackers vs own ATTACK strength. Tests whether team quality "
                    "translates to FPL value differently by position.",
            "defenders_vs_own_defence": dfn,
            "attackers_vs_own_attack": att}


def factor_10_minutes(all_rows):
    """The gate — measured across ALL rows (not just starters)."""
    return {"note": "Spearman(minutes, points) across ALL appearances+non-appearances. "
                    "The dominant availability gate: it confounds every other factor, "
                    "which is why #1-9,11 condition on starters (>=60 min).",
            "all_rows": _corr_by_pos(all_rows, "minutes")}


def factor_11_set_piece(client, all_rows):
    """2025/26 only. Penalty-takers (bootstrap penalties_order) vs rest."""
    import json
    from pathlib import Path
    bs = json.load(open(Path(__file__).parent.parent / "raw" / "2025-26" / "bootstrap-static.json"))
    # element id → is penalty taker (order 1 or 2)
    taker = {e["id"]: bool(e.get("penalties_order")) for e in bs["elements"]}
    el_of = {p["id"]: p["fpl_element_id"] for p in query.fetch_all(client, "players",
             "id, fpl_element_id", filters={"season_id": "2025-26"})}
    rows = _starters([r for r in all_rows if r["season"] == "2025-26"])
    out = {}
    for pos, pr in _by_pos(rows).items():
        tk = [r["points"] for r in pr if taker.get(el_of.get(r["player_id"]))]
        no = [r["points"] for r in pr if not taker.get(el_of.get(r["player_id"]))]
        out[pos] = stats.mean_diff(tk, no)  # delta = taker - non-taker
    return {"note": "penalty-takers (bootstrap penalties_order set) vs non-takers, mean "
                    "points, starters. 2025/26 ONLY (no set-piece data pre-2025/26); "
                    "only ~60 takers league-wide, so cells thin once split by position.",
            "taker_vs_non": out}
