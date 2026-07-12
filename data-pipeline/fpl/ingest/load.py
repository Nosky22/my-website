"""Idempotent Supabase upserts for every fpl.* table.

All writes use the service-role key (bypasses RLS). Re-running is safe —
upserts resolve on the natural keys defined in the schema.
"""
from __future__ import annotations

import logging

from supabase import Client, create_client

log = logging.getLogger(__name__)

BATCH = 500  # rows per upsert request


def make_client(url: str, key: str) -> Client:
    return create_client(url, key)


def _fpl(client: Client):
    return client.schema("fpl")


def _batch_upsert(client: Client, table: str, rows: list[dict], on_conflict: str) -> list[dict]:
    """Upsert in batches; returns all returned rows concatenated."""
    returned: list[dict] = []
    for i in range(0, len(rows), BATCH):
        chunk = rows[i : i + BATCH]
        result = (
            _fpl(client).table(table).upsert(chunk, on_conflict=on_conflict).execute()
        )
        returned.extend(result.data or [])
    return returned


# ── Per-table upserts ──────────────────────────────────────────────────────────

def upsert_season(client: Client, row: dict) -> None:
    _fpl(client).table("seasons").upsert(row, on_conflict="id").execute()
    log.info("season %s upserted", row["id"])


def upsert_teams(client: Client, rows: list[dict]) -> dict[int, int]:
    """Returns {fpl_team_id → internal id}."""
    data = _batch_upsert(client, "teams", rows, "season_id,fpl_team_id")
    return {r["fpl_team_id"]: r["id"] for r in data}


def upsert_gameweeks(client: Client, rows: list[dict]) -> None:
    _batch_upsert(client, "gameweeks", rows, "season_id,gw_number")


def upsert_canonical_players(client: Client, rows: list[dict]) -> dict[int, int]:
    """Returns {fpl_code → canonical id}."""
    data = _batch_upsert(client, "canonical_players", rows, "fpl_code")
    return {r["fpl_code"]: r["id"] for r in data}


def upsert_players(client: Client, rows: list[dict]) -> dict[int, int]:
    """Returns {fpl_element_id → player id}."""
    data = _batch_upsert(client, "players", rows, "season_id,fpl_element_id")
    return {r["fpl_element_id"]: r["id"] for r in data}


def upsert_fixtures(client: Client, rows: list[dict]) -> dict[int, int]:
    """Returns {fpl_fixture_id → internal id}."""
    data = _batch_upsert(client, "fixtures", rows, "season_id,fpl_fixture_id")
    return {r["fpl_fixture_id"]: r["id"] for r in data}


def upsert_player_gameweeks(client: Client, rows: list[dict]) -> int:
    """Returns count of rows upserted."""
    if not rows:
        return 0
    data = _batch_upsert(
        client, "player_gameweeks", rows, "player_id,gw_number,fixture_id"
    )
    return len(data)
