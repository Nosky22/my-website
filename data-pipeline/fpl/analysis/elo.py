"""Team ELO across six seasons, warmed by two burn-in seasons.

Walk-forward by construction: the rating written for (team, season, gw) is the
model's state after processing ONLY matches up to and including that gw. Ratings
carry across seasons by persistent team `code`, regressed toward the mean at each
boundary; promoted teams enter at a fixed below-mean level. HFA is regime-based
by match date (normal vs behind-closed-doors), never fit from the recorded window.

MOV: FiveThirtyEight soccer margin-of-victory multiplier (log goal-diff, damped
by pre-match rating gap to curb autocorrelation).
"""
from __future__ import annotations

import logging
import math
import statistics
from datetime import date, datetime

from ingest import load, query
from analysis import burnin, params as P

log = logging.getLogger(__name__)


def _mov_mult(gd: int, winner_diff: float) -> float:
    """538 margin-of-victory multiplier; 1.0 for draws."""
    if gd == 0:
        return 1.0
    return math.log(abs(gd) + 1) * (2.2 / (winner_diff * 0.001 + 2.2))


def _apply(ratings: dict, hc: int, ac: int, hs: int, a_s: int, hfa: float) -> None:
    Rh, Ra = ratings[hc], ratings[ac]
    Eh = 1.0 / (1.0 + 10 ** (-((Rh + hfa) - Ra) / 400.0))
    Sh = 1.0 if hs > a_s else (0.5 if hs == a_s else 0.0)
    gd = hs - a_s
    if gd > 0:
        winner_diff = (Rh + hfa) - Ra
    elif gd < 0:
        winner_diff = Ra - (Rh + hfa)
    else:
        winner_diff = 0.0
    delta = P.ELO_K * _mov_mult(gd, winner_diff) * (Sh - Eh)
    ratings[hc] = Rh + delta
    ratings[ac] = Ra - delta


def _season_boundary(ratings: dict, new_codes: set[int], prior_codes: set[int],
                     first: bool) -> dict:
    """Return fresh ratings for `new_codes` entering a season."""
    out = {}
    for code in new_codes:
        if first:
            out[code] = P.ELO_START
        elif code in prior_codes:  # continuing → regress toward mean
            out[code] = 1500.0 + (1.0 - P.BOUNDARY_REGRESSION) * (ratings[code] - 1500.0)
        else:                      # promoted / returning → fixed baseline
            out[code] = P.PROMOTED_ELO
    return out


# ── Recorded-season fixtures (from the DB) ──────────────────────────────────

def _recorded_fixtures(client, season: str, code_of: dict[int, int]):
    """Chronological (gw, kickoff, home_code, away_code, hs, as) for a season."""
    fx = query.fetch_all(client, "fixtures",
        "gw_number, kickoff_time, home_team_id, away_team_id, home_score, away_score, finished",
        filters={"season_id": season})
    out = []
    for f in fx:
        if not f["finished"] or f["home_score"] is None:
            continue
        kt = f.get("kickoff_time")
        kd = datetime.fromisoformat(kt.replace("Z", "+00:00")).date() if kt else date(2000, 1, 1)
        out.append((f["gw_number"], kd, code_of[f["home_team_id"]],
                    code_of[f["away_team_id"]], f["home_score"], f["away_score"]))
    out.sort(key=lambda r: (r[0], r[1]))
    return out


def run(client) -> dict:
    """Build ELO through burn-in + recorded seasons; write team_elo. Returns diag."""
    ratings: dict[int, int] = {}
    diag = {"burnin": [], "params": {
        "K": P.ELO_K, "start": P.ELO_START, "promoted": P.PROMOTED_ELO,
        "boundary_regression": P.BOUNDARY_REGRESSION,
        "hfa_normal": P.HFA_NORMAL, "hfa_bcd": P.HFA_BCD}}

    # ── Burn-in (2018-19, 2019-20) — warm ratings, do not record ──
    bm = burnin.burnin_matches()
    prior_codes: set[int] = set()
    for i, season in enumerate(P.BURNIN_SEASONS):
        smatches = [m for m in bm if m["season"] == season]
        new_codes = {m["home_code"] for m in smatches} | {m["away_code"] for m in smatches}
        ratings = {**ratings, **_season_boundary(ratings, new_codes, prior_codes, first=(i == 0))}
        # process chronologically; track rating spread per ~GW for convergence
        for m in smatches:
            _apply(ratings, m["home_code"], m["away_code"], m["hs"], m["as"], P.hfa_for(m["date"]))
        diag["burnin"].append({"season": season, "std_after": round(statistics.pstdev(ratings.values()), 1)})
        prior_codes = new_codes

    # finer burn-in convergence: std of ratings after each burn-in match, downsampled
    conv = []
    r2: dict[int, int] = {}
    pc: set[int] = set()
    for i, season in enumerate(P.BURNIN_SEASONS):
        smatches = [m for m in bm if m["season"] == season]
        nc = {m["home_code"] for m in smatches} | {m["away_code"] for m in smatches}
        r2 = {**r2, **_season_boundary(r2, nc, pc, first=(i == 0))}
        for j, m in enumerate(smatches):
            _apply(r2, m["home_code"], m["away_code"], m["hs"], m["as"], P.hfa_for(m["date"]))
            if j % 10 == 0:
                conv.append(round(statistics.pstdev(r2.values()), 1))
        pc = nc
    diag["convergence_std_every10matches"] = conv

    # ── Recorded seasons — snapshot after each GW ──
    total = 0
    for season in P.RECORDED_SEASONS:
        teams = query.fetch_all(client, "teams", "id, code", filters={"season_id": season})
        code_of = {t["id"]: t["code"] for t in teams}      # team_id → code
        id_of = {t["code"]: t["id"] for t in teams}        # code → team_id
        new_codes = set(id_of)
        ratings = {**ratings, **_season_boundary(ratings, new_codes, prior_codes, first=False)}

        fixtures = _recorded_fixtures(client, season, code_of)
        gws = sorted({r[0] for r in fixtures})
        rows = []
        by_gw: dict[int, list] = {}
        for r in fixtures:
            by_gw.setdefault(r[0], []).append(r)
        for gw in gws:
            for (_, kd, hc, ac, hs, a_s) in by_gw[gw]:
                _apply(ratings, hc, ac, hs, a_s, P.hfa_for(kd))
            # snapshot ALL teams after this GW (carry-forward for idle teams)
            for code, tid in id_of.items():
                rows.append({"team_id": tid, "season_id": season,
                             "gw_number": gw, "elo": round(ratings[code], 2)})
        total += load.upsert_team_elo(client, rows)
        prior_codes = new_codes
        log.info("team_elo %s: %d rows", season, len(rows))

    diag["team_elo_rows"] = total
    return diag
