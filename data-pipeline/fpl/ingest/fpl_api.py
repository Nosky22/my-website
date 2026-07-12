"""FPL API client with rate limiting, retry, and local JSON cache.

All responses are saved to raw/{season}/ before returning, so re-runs skip
the network entirely (cache-first). This also serves as the irreplaceable
backup of live 2025/26 data.
"""
from __future__ import annotations

import json
import logging
import random
import time
from pathlib import Path

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

log = logging.getLogger(__name__)

BASE = "https://fantasy.premierleague.com/api/"
RAW_DIR = Path(__file__).parent.parent / "raw"
MIN_INTERVAL = 1.05  # seconds between live requests (stays under 1 rps)

_last_request_at: float = 0.0


class _RateLimitError(Exception):
    pass


def _throttle() -> None:
    global _last_request_at
    gap = time.monotonic() - _last_request_at
    if gap < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - gap + random.uniform(0, 0.15))
    _last_request_at = time.monotonic()


@retry(
    retry=retry_if_exception_type(_RateLimitError),
    wait=wait_exponential(multiplier=2, min=4, max=120),
    stop=stop_after_attempt(6),
    reraise=True,
)
def _get(url: str) -> dict | list:
    _throttle()
    log.debug("GET %s", url)
    resp = requests.get(url, timeout=30, headers={"User-Agent": "FPL-Badger/1.0"})
    if resp.status_code in (429,) or resp.status_code >= 500:
        log.warning("Retryable %s from %s", resp.status_code, url)
        raise _RateLimitError(f"{resp.status_code}")
    resp.raise_for_status()
    return resp.json()


def _cache(season: str, filename: str) -> Path:
    return RAW_DIR / season / filename


def _load_or_fetch(season: str, filename: str, url: str) -> dict | list:
    path = _cache(season, filename)
    if path.exists():
        log.debug("cache hit: %s", path)
        return json.loads(path.read_text())
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _get(url)
    path.write_text(json.dumps(data, indent=2))
    log.debug("cached: %s", path)
    return data


# ── Public helpers ─────────────────────────────────────────────────────────────

def get_bootstrap(season: str) -> dict:
    return _load_or_fetch(season, "bootstrap-static.json", f"{BASE}bootstrap-static/")


def get_fixtures(season: str) -> list:
    return _load_or_fetch(season, "fixtures.json", f"{BASE}fixtures/")


def get_element_summary(season: str, element_id: int) -> dict:
    return _load_or_fetch(
        season,
        f"element-summary/{element_id}.json",
        f"{BASE}element-summary/{element_id}/",
    )


def get_entry(season: str, entry_id: int) -> dict:
    return _load_or_fetch(season, f"entry-{entry_id}.json", f"{BASE}entry/{entry_id}/")


def get_entry_history(season: str, entry_id: int) -> dict:
    return _load_or_fetch(
        season, f"entry-{entry_id}-history.json", f"{BASE}entry/{entry_id}/history/"
    )


def get_entry_transfers(season: str, entry_id: int) -> list:
    return _load_or_fetch(
        season,
        f"entry-{entry_id}-transfers.json",
        f"{BASE}entry/{entry_id}/transfers/",
    )


def get_league_standings(season: str, league_id: int, page: int = 1) -> dict:
    return _load_or_fetch(
        season,
        f"league-{league_id}-p{page}.json",
        f"{BASE}leagues-classic/{league_id}/standings/?page_standings={page}",
    )
