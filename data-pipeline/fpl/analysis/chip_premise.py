"""Chip-timing premise test — is the '+49 pts from optimal chip timing' prize real
on OUR data? Pre-registered, before building any planner.

Uses 150 elite managers' ACTUAL squads for all 38 GWs of 2025/26 (real picks, not
hypothetical) + real fixtures (so real DGWs/BGWs are known: DGW GW26/33/36,
BGW GW31/34). For each manager, each GW, value each chip GIVEN THEIR ACTUAL SQUAD:

  Bench Boost   = their bench (squad slots 12-15) points that GW.
  Triple Captain= their best owned player's score that GW (the +1x over a normal 2x).
  Free Hit      = best legal one-week squad's points (£100m, optimal XI+captain,
                  via the Study 7 ILP) minus their actual GW points. APPROXIMATE:
                  assumes you field the globally-optimal single-GW squad; ignores
                  that FH keeps your chip/transfer state.
  Wildcard      = NOT within-week measurable -> excluded (noted, not fudged).

Then per chip, per half (GW1-19 / GW20-38, reported separately — Study 8 found
first-half timing uninformative and DGWs cluster late), compare:
  actual (their real timing) · optimal (best GW in the half) · random (mean over
  the half) · heuristic ("play it in your biggest double").

PRE-REGISTERED — criteria fixed before measuring (see constants):
  PRIZE_REAL      : mean(optimal - actual) >= PRIZE_MIN_PTS for BB or TC in H2.
  ELITE_LEAVE_GAP : elite capture_rate = (actual-random)/(optimal-random) < CAPTURE_HI
                    (if they already capture most, a planner adds little).
  SIMPLE_SUFFICES : heuristic_capture >= HEUR_HI (the biggest-DGW rule already gets
                    most of the edge -> build a SIMPLE rule, not a sophisticated planner).
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from ingest import query
from analysis import optimizer as O

SEASON = "2025-26"
H1_LAST = 19
CHIPS = {"bboost": "BB", "3xc": "TC", "freehit": "FH"}   # wildcard excluded

# ── PRE-REGISTERED CRITERIA ───────────────────────────────────────────────────
PRIZE_MIN_PTS = 5.0     # mean(optimal-actual) to call the timing prize "real"
CAPTURE_HI = 0.70       # elite capture rate above this => they already get most of it
HEUR_HI = 0.70          # heuristic capture above this => a simple rule suffices


def load_all(client):
    fx = {f["id"]: f for f in query.fetch_all(client, "fixtures",
            "id, home_team_id, away_team_id, gw_number", filters={"season_id": SEASON})}
    dgw = defaultdict(int)                                  # (team, gw) -> fixture count
    for f in fx.values():
        if f["gw_number"]:
            dgw[(f["home_team_id"], f["gw_number"])] += 1
            dgw[(f["away_team_id"], f["gw_number"])] += 1

    pt = defaultdict(lambda: defaultdict(float))           # pid -> gw -> points
    price = {}                                             # (pid, gw) -> value
    club = {}                                              # (pid, gw) -> team
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, total_points, value",
            filters={"season_id": SEASON}):
        pid, gw = r["player_id"], r["gw_number"]
        pt[pid][gw] += r["total_points"] or 0
        f = fx.get(r["fixture_id"])
        if f and r["was_home"] is not None:
            club[(pid, gw)] = f["home_team_id"] if r["was_home"] else f["away_team_id"]
            if r["value"] is not None:
                price[(pid, gw)] = float(r["value"])
    pos = {p["id"]: p["position"] for p in query.fetch_all(
        client, "players", "id, position", filters={"season_id": SEASON})}

    squads = defaultdict(lambda: {"starters": [], "bench": [], "all": []})
    for r in query.fetch_all(client, "manager_picks",
            "manager_entry_id, gw_number, player_id, position", filters={"season_id": SEASON}):
        s = squads[(r["manager_entry_id"], r["gw_number"])]
        s["all"].append(r["player_id"])
        (s["bench"] if r["position"] >= 12 else s["starters"]).append(r["player_id"])

    actual_pts, chip_played = defaultdict(dict), {}
    for r in query.fetch_all(client, "manager_gameweeks",
            "manager_entry_id, gw_number, chip, points", filters={"season_id": SEASON}):
        actual_pts[r["manager_entry_id"]][r["gw_number"]] = r["points"]
        if r["chip"]:
            chip_played[(r["manager_entry_id"], r["gw_number"])] = r["chip"]

    gws = sorted({gw for p in pt.values() for gw in p})
    managers = sorted(actual_pts)
    return dict(fx=fx, dgw=dgw, pt=pt, price=price, club=club, pos=pos, squads=squads,
                actual_pts=actual_pts, chip_played=chip_played, gws=gws, managers=managers)


def fh_ceiling(D):
    """Best legal one-week squad (points) per GW — the FH ceiling. 38 small ILPs."""
    ceil = {}
    for gw in D["gws"]:
        players, points = [], {}
        for pid in D["pos"]:
            if (pid, gw) in D["price"] and (pid, gw) in D["club"]:
                players.append({"id": pid, "position": D["pos"][pid],
                                "price": D["price"][(pid, gw)], "club": D["club"][(pid, gw)]})
                points[pid] = {gw: D["pt"][pid].get(gw, 0.0)}
        sol = O.solve_set_and_forget(players, points, [gw], startable=None, time_limit=60)
        ceil[gw] = sol.total_points
    return ceil


def chip_value(D, m, gw, chip, ceil):
    sq = D["squads"].get((m, gw))
    if not sq:
        return None
    if chip == "bboost":
        return sum(D["pt"][p].get(gw, 0.0) for p in sq["bench"])
    if chip == "3xc":
        return max((D["pt"][p].get(gw, 0.0) for p in sq["all"]), default=0.0)
    if chip == "freehit":
        return max(0.0, ceil.get(gw, 0.0) - (D["actual_pts"][m].get(gw) or 0.0))
    return None


def _dgw_count(D, m, gw):
    sq = D["squads"].get((m, gw))
    return sum(1 for p in sq["all"] if D["dgw"].get((D["club"].get((p, gw)), gw), 0) >= 2) if sq else 0


def run(client):
    D = load_all(client)
    ceil = fh_ceiling(D)
    halves = {"H1": [g for g in D["gws"] if g <= H1_LAST],
              "H2": [g for g in D["gws"] if g > H1_LAST]}
    out = {}
    for chip, tag in CHIPS.items():
        for hname, hgws in halves.items():
            rows = []
            for m in D["managers"]:
                played = [(m, g) for g in hgws if D["chip_played"].get((m, g)) == chip]
                if not played:
                    continue
                actual_gw = played[0][1]
                vals = {g: chip_value(D, m, g, chip, ceil) for g in hgws}
                vals = {g: v for g, v in vals.items() if v is not None}
                if not vals or actual_gw not in vals:
                    continue
                actual = vals[actual_gw]
                optimal = max(vals.values())
                rnd = statistics.mean(vals.values())
                # heuristic = biggest-double GW in the half (None if no doubles)
                dgw_by_gw = {g: _dgw_count(D, m, g) for g in vals}
                heur_gw = max(dgw_by_gw, key=lambda g: dgw_by_gw[g]) if max(dgw_by_gw.values()) > 0 else None
                heur = vals.get(heur_gw) if heur_gw is not None else None
                rows.append((actual, optimal, rnd, heur, actual_gw))
            if not rows:
                out[f"{tag}-{hname}"] = None
                continue
            act = statistics.mean(r[0] for r in rows)
            opt = statistics.mean(r[1] for r in rows)
            rnd = statistics.mean(r[2] for r in rows)
            heur_rows = [r for r in rows if r[3] is not None]
            heur = statistics.mean(r[3] for r in heur_rows) if heur_rows else None
            denom = opt - rnd
            out[f"{tag}-{hname}"] = {
                "n": len(rows), "actual": round(act, 1), "optimal": round(opt, 1),
                "random": round(rnd, 1), "heuristic": round(heur, 1) if heur is not None else None,
                "left_on_table": round(opt - act, 1),
                "capture_rate": round((act - rnd) / denom, 2) if denom > 0.1 else None,
                "heuristic_capture": (round((heur - rnd) / denom, 2)
                                      if heur is not None and denom > 0.1 else None),
                "actual_gw_mode": statistics.mode(r[4] for r in rows),
            }
    return out, D, ceil
