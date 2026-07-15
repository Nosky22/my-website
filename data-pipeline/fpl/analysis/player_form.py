"""Rolling player form (last-4 / last-6 active gameweeks) → fpl.player_form.

Walk-forward: form at as_of_gw uses only the player's gameweeks <= as_of_gw.
DGW rows are aggregated within their gameweek. xGI-based fields (xgi_per90,
baseline, form_delta) are null for no_xg seasons; minutes/points always present.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from ingest import load, query
from analysis import params as P

log = logging.getLogger(__name__)


def _player_gw_records(client, season: str):
    """{player_id: [chronological per-GW dicts]} aggregating DGW rows per GW."""
    rows = query.fetch_all(client, "player_gameweeks",
        "player_id, gw_number, minutes, total_points, expected_goal_involvements",
        filters={"season_id": season})
    byp: dict[int, dict[int, dict]] = defaultdict(lambda: defaultdict(
        lambda: {"minutes": 0, "points": 0, "xgi": 0.0, "xgi_present": False}))
    for r in rows:
        rec = byp[r["player_id"]][r["gw_number"]]
        rec["minutes"] += r["minutes"] or 0
        rec["points"] += r["total_points"] or 0
        if r["expected_goal_involvements"] is not None:
            rec["xgi"] += float(r["expected_goal_involvements"])
            rec["xgi_present"] = True
    out = {}
    for pid, gwmap in byp.items():
        out[pid] = [dict(gw=gw, **rec) for gw, rec in sorted(gwmap.items())]
    return out


def _xgi_per90(records) -> float | None:
    mins = sum(r["minutes"] for r in records)
    if mins <= 0 or not all(r["xgi_present"] for r in records):
        return None
    return sum(r["xgi"] for r in records) / mins * 90.0


def run(client) -> int:
    total = 0
    for season in P.RECORDED_SEASONS:
        has_xg = season in P.FULL_XG_SEASONS
        per = _player_gw_records(client, season)
        rows = []
        for pid, recs in per.items():
            for i, rec in enumerate(recs):
                as_of = rec["gw"]
                sofar = recs[: i + 1]                       # season-to-date <= as_of
                baseline = _xgi_per90(sofar) if has_xg else None
                for w in P.PLAYER_FORM_WINDOWS:
                    win = sofar[-w:]
                    played = len(win)
                    mins = sum(r["minutes"] for r in win)
                    xgi90 = _xgi_per90(win) if has_xg else None
                    rows.append({
                        "player_id": pid, "season_id": season, "as_of_gw": as_of,
                        "window_games": w,
                        "minutes_per_game": round(mins / played, 1),
                        "points_per_game": round(sum(r["points"] for r in win) / played, 2),
                        "xgi_per90": round(xgi90, 3) if xgi90 is not None else None,
                        "xgi_per90_season_baseline": round(baseline, 3) if baseline is not None else None,
                        "form_delta": round(xgi90 - baseline, 3)
                            if (xgi90 is not None and baseline is not None) else None,
                    })
        total += load.upsert_player_form(client, rows)
        log.info("player_form %s: %d rows", season, len(rows))
    return total
