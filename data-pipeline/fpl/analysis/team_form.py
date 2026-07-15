"""Rolling team form (last-6 / last-10 matches) → fpl.team_form.

Walk-forward: form at as_of_gw uses only matches with gw_number <= as_of_gw.
xPts/pts_vs_xpts populated for full_xg seasons only (null otherwise).
"""
from __future__ import annotations

import logging

from ingest import load, query
from analysis import params as P
from analysis import xpts as X

log = logging.getLogger(__name__)


def _team_matches(client, season: str, has_xg: bool):
    """{team_id: [chronological match dicts]} with result + xG per match."""
    fx = query.fetch_all(client, "fixtures",
        "id, gw_number, kickoff_time, home_team_id, away_team_id, home_score, away_score, finished",
        filters={"season_id": season})
    xg = X.team_match_xg(client, season) if has_xg else {}
    per: dict[int, list] = {}
    for f in fx:
        if not f["finished"] or f["home_score"] is None:
            continue
        for team, opp, gf, ga in (
            (f["home_team_id"], f["away_team_id"], f["home_score"], f["away_score"]),
            (f["away_team_id"], f["home_team_id"], f["away_score"], f["home_score"]),
        ):
            xg_for = xg.get((f["id"], team))
            xg_ag = xg.get((f["id"], opp))
            xpts = (X.match_xpts(xg_for, xg_ag)
                    if has_xg and xg_for is not None and xg_ag is not None else None)
            per.setdefault(team, []).append({
                "gw": f["gw_number"], "kickoff": f["kickoff_time"] or "",
                "gf": gf, "ga": ga,
                "res": "W" if gf > ga else ("D" if gf == ga else "L"),
                "pts": 3 if gf > ga else (1 if gf == ga else 0),
                "xpts": xpts,
            })
    for t in per:
        per[t].sort(key=lambda m: (m["gw"], m["kickoff"]))
    return per


def run(client) -> int:
    total = 0
    for season in P.RECORDED_SEASONS:
        has_xg = season in P.FULL_XG_SEASONS
        per = _team_matches(client, season, has_xg)
        gws = sorted({m["gw"] for ms in per.values() for m in ms})
        rows = []
        for team, matches in per.items():
            for as_of in gws:
                played_all = [m for m in matches if m["gw"] <= as_of]
                if not played_all:
                    continue
                for w in P.TEAM_FORM_WINDOWS:
                    win = played_all[-w:]
                    xps = [m["xpts"] for m in win if m["xpts"] is not None]
                    xpts = round(sum(xps), 2) if (has_xg and len(xps) == len(win)) else None
                    pts = sum(m["pts"] for m in win)
                    rows.append({
                        "team_id": team, "season_id": season, "as_of_gw": as_of,
                        "window_games": w, "played": len(win),
                        "won": sum(m["res"] == "W" for m in win),
                        "drawn": sum(m["res"] == "D" for m in win),
                        "lost": sum(m["res"] == "L" for m in win),
                        "goals_for": sum(m["gf"] for m in win),
                        "goals_against": sum(m["ga"] for m in win),
                        "points": pts,
                        "xpts": xpts,
                        "pts_vs_xpts": round(pts - xpts, 2) if xpts is not None else None,
                    })
        total += load.upsert_team_form(client, rows)
        log.info("team_form %s: %d rows", season, len(rows))
    return total
