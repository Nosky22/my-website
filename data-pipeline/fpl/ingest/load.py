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


# ── Personal (user-scoped) ──────────────────────────────────────────────────

def upsert_my_entry(client: Client, row: dict) -> None:
    _fpl(client).table("my_entry").upsert(row, on_conflict="user_id,season_id").execute()
    log.info("my_entry upserted (season %s)", row["season_id"])


def upsert_my_entry_gameweeks(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client, "my_entry_gameweeks", rows, "user_id,season_id,gw_number"
    )
    return len(data)


def upsert_my_league_standings(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client,
        "my_league_standings",
        rows,
        "user_id,season_id,league_id,as_of_gw,rival_entry_id",
    )
    return len(data)


# ── Derived analysis tables (Study 1: form & ELO) ───────────────────────────

def upsert_team_elo(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    return len(_batch_upsert(client, "team_elo", rows, "team_id,season_id,gw_number"))


def upsert_team_form(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    return len(_batch_upsert(
        client, "team_form", rows, "team_id,season_id,as_of_gw,window_games"))


def upsert_player_form(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    return len(_batch_upsert(
        client, "player_form", rows, "player_id,season_id,as_of_gw,window_games"))


# ── Elite-manager capture (cohort analysis) ─────────────────────────────────

def upsert_manager_picks(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client, "manager_picks", rows,
        "season_id,manager_entry_id,gw_number,player_id",
    )
    return len(data)


def upsert_manager_gameweeks(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client, "manager_gameweeks", rows,
        "season_id,manager_entry_id,gw_number",
    )
    return len(data)


def upsert_manager_transfers(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client, "manager_transfers", rows,
        "season_id,manager_entry_id,gw_number,player_in_id,player_out_id,transfer_time",
    )
    return len(data)


def upsert_manager_seasons(client: Client, rows: list[dict]) -> int:
    if not rows:
        return 0
    data = _batch_upsert(
        client, "manager_seasons", rows, "manager_entry_id,season_name",
    )
    return len(data)
