"""Burn-in match data (2018-19 + 2019-20) to warm the ELO before recording.

Same vaastav source as the archive; no new dependency. 2016-17/2017-18 are
unavailable from vaastav (404) and deliberately excluded rather than substituted.

Team identity is resolved to the persistent `code`:
  - 2019-20: teams.csv carries (id, code) directly.
  - 2018-19: teams.csv is absent, but players_raw.csv carries (team, team_code).
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime
from pathlib import Path

import requests

log = logging.getLogger(__name__)

RAW = Path(__file__).parent.parent / "raw"
VAASTAV = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
UA = "FPL-Badger/1.0 (elo burn-in)"


def _cached_csv(season: str, filename: str, path_in_repo: str) -> list[dict]:
    path = RAW / season / filename
    if path.exists():
        return list(csv.DictReader(io.StringIO(path.read_bytes().decode("utf-8", "replace"))))
    import time, random
    time.sleep(1.05 + random.uniform(0, 0.15))
    url = f"{VAASTAV}/{season}/{path_in_repo}"
    log.info("burn-in download %s", url)
    resp = requests.get(url, timeout=60, headers={"User-Agent": UA})
    resp.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    return list(csv.DictReader(io.StringIO(resp.content.decode("utf-8", "replace"))))


def _team_code_map(season: str) -> dict[int, int]:
    """{season team id → persistent code}."""
    if season == "2018-19":  # teams.csv absent; rebuild from players_raw
        rows = _cached_csv(season, "players_raw.csv", "players_raw.csv")
        return {int(r["team"]): int(r["team_code"]) for r in rows}
    rows = _cached_csv(season, "teams.csv", "teams.csv")
    return {int(r["id"]): int(r["code"]) for r in rows}


def _kickoff_date(s: str) -> date | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except (ValueError, AttributeError):
        return None


def burnin_matches() -> list[dict]:
    """Chronological burn-in matches as {date, home_code, away_code, hs, as}."""
    matches = []
    for season in ("2018-19", "2019-20"):
        code = _team_code_map(season)
        for f in _cached_csv(season, "fixtures.csv", "fixtures.csv"):
            try:
                hs, a_s = int(f["team_h_score"]), int(f["team_a_score"])
            except (ValueError, KeyError):
                continue  # unplayed
            kd = _kickoff_date(f.get("kickoff_time", ""))
            matches.append({
                "date": kd,
                "home_code": code.get(int(f["team_h"])),
                "away_code": code.get(int(f["team_a"])),
                "hs": hs, "as": a_s,
                "season": season,
            })
    matches.sort(key=lambda m: (m["date"] or date(2100, 1, 1)))
    return matches
