"""Transform raw FPL API responses into schema-shaped dicts ready for upsert."""
from __future__ import annotations

from typing import Optional

POSITION_MAP = {1: "GKP", 2: "DEF", 3: "MID", 4: "FWD"}


def transform_season(bootstrap: dict, season_id: str) -> dict:
    return {
        "id": season_id,
        "start_year": int(season_id.split("-")[0]),
        "data_tier": "full_xg",
        "is_current": True,
        "source": "live_api",
    }


def transform_teams(bootstrap: dict, season_id: str) -> list[dict]:
    return [
        {
            "season_id": season_id,
            "fpl_team_id": t["id"],
            "name": t["name"],
            "short_name": t["short_name"],
            "strength_overall_home": t.get("strength_overall_home"),
            "strength_overall_away": t.get("strength_overall_away"),
            "strength_attack_home": t.get("strength_attack_home"),
            "strength_attack_away": t.get("strength_attack_away"),
            "strength_defence_home": t.get("strength_defence_home"),
            "strength_defence_away": t.get("strength_defence_away"),
        }
        for t in bootstrap["teams"]
    ]


def transform_gameweeks(bootstrap: dict, season_id: str) -> list[dict]:
    return [
        {
            "season_id": season_id,
            "gw_number": e["id"],
            "deadline_time": e.get("deadline_time"),
            "average_score": e.get("average_entry_score"),
            "highest_score": e.get("highest_score"),
            "finished": bool(e.get("finished", False)),
        }
        for e in bootstrap["events"]
    ]


def transform_canonical_players(bootstrap: dict) -> list[dict]:
    return [
        {
            "full_name": f"{el['first_name']} {el['second_name']}",
            "fpl_code": el["code"],
        }
        for el in bootstrap["elements"]
    ]


def transform_players(
    bootstrap: dict,
    season_id: str,
    team_fpl_to_db: dict[int, int],
    canonical_code_to_db: dict[int, int],
) -> list[dict]:
    rows = []
    for el in bootstrap["elements"]:
        rows.append(
            {
                "season_id": season_id,
                "canonical_id": canonical_code_to_db.get(el["code"]),
                "fpl_element_id": el["id"],
                "team_id": team_fpl_to_db.get(el["team"]),
                "web_name": el["web_name"],
                "first_name": el.get("first_name"),
                "second_name": el.get("second_name"),
                "position": POSITION_MAP[el["element_type"]],
            }
        )
    return rows


def transform_fixtures(
    fixtures_raw: list[dict],
    season_id: str,
    team_fpl_to_db: dict[int, int],
) -> list[dict]:
    rows = []
    for f in fixtures_raw:
        rows.append(
            {
                "season_id": season_id,
                "fpl_fixture_id": f["id"],
                "gw_number": f.get("event"),
                "kickoff_time": f.get("kickoff_time"),
                "home_team_id": team_fpl_to_db.get(f.get("team_h")),
                "away_team_id": team_fpl_to_db.get(f.get("team_a")),
                "home_score": f.get("team_h_score"),
                "away_score": f.get("team_a_score"),
                "home_difficulty": f.get("team_h_difficulty"),
                "away_difficulty": f.get("team_a_difficulty"),
                "finished": bool(f.get("finished", False)),
            }
        )
    return rows


def _dec(val) -> Optional[float]:
    """Parse a numeric string or number to float; return None if missing."""
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def transform_player_gameweeks(
    history: list[dict],
    player_id: int,
    season_id: str,
    fixture_fpl_to_db: dict[int, int],
    team_fpl_to_db: dict[int, int],
    gw_ranked_count: dict[int, int],
) -> list[dict]:
    rows = []
    for h in history:
        fpl_fixture_id = h.get("fixture")
        fixture_id = fixture_fpl_to_db.get(fpl_fixture_id) if fpl_fixture_id else None
        gw_number = h.get("round")

        selected_raw = h.get("selected")
        selected_by: Optional[float] = None
        rc = gw_ranked_count.get(gw_number, 0) if gw_number is not None else 0
        if selected_raw is not None and rc > 0:
            selected_by = round(selected_raw / rc * 100, 2)

        defensive = h.get("defensive_contribution")

        rows.append(
            {
                "season_id": season_id,
                "player_id": player_id,
                "gw_number": gw_number,
                "fixture_id": fixture_id,
                "opponent_team_id": team_fpl_to_db.get(h.get("opponent_team")),
                "was_home": h.get("was_home"),
                "minutes": h.get("minutes", 0),
                "total_points": h.get("total_points", 0),
                "goals_scored": h.get("goals_scored", 0),
                "assists": h.get("assists", 0),
                "clean_sheets": h.get("clean_sheets", 0),
                "goals_conceded": h.get("goals_conceded", 0),
                "own_goals": h.get("own_goals", 0),
                "penalties_saved": h.get("penalties_saved", 0),
                "penalties_missed": h.get("penalties_missed", 0),
                "yellow_cards": h.get("yellow_cards", 0),
                "red_cards": h.get("red_cards", 0),
                "saves": h.get("saves", 0),
                "bonus": h.get("bonus", 0),
                "bps": h.get("bps", 0),
                "expected_goals": _dec(h.get("expected_goals")),
                "expected_assists": _dec(h.get("expected_assists")),
                "expected_goal_involvements": _dec(h.get("expected_goal_involvements")),
                "expected_goals_conceded": _dec(h.get("expected_goals_conceded")),
                "defensive_contribution": defensive,
                "value": round(h["value"] / 10, 1) if h.get("value") else None,
                "selected_by": selected_by,
                "transfers_in": h.get("transfers_in"),
                "transfers_out": h.get("transfers_out"),
            }
        )
    return rows
