"""vaastav Fantasy-Premier-League archive ingestion (2020/21–2024/25).

Phase 0 priority 3 — implement after live 2025/26 capture is verified.

DEFERRED PERSONAL LOAD (MUST NOT BE LOST):
    The personal capture (run_phase0.py --personal) already cached the manager's
    full entry history to raw/2025-26/entry-<id>-history.json, whose `past` array
    holds prior-season overall points/rank (2022/23–2024/25 for this manager).
    Those rows were NOT loaded into fpl.my_entry because my_entry.season_id has a
    foreign key to fpl.seasons, which only contained 2025-26 at capture time.

    THEREFORE, as part of this archive step, AFTER inserting each archive season
    into fpl.seasons, this module MUST ALSO back-fill the cached past-season
    personal rows:
      1. Read raw/2025-26/entry-<FPL_ENTRY_ID>-history.json  (`past` array).
      2. For each past season now present in fpl.seasons, upsert an fpl.my_entry
         row (transform.transform_my_entry-style: user_id, fpl_entry_id,
         season_id, team_name, overall_points=total_points, overall_rank=rank).
         season_name '2024/25' maps to season_id '2024-25'.
      3. Attribute to the same admin user_id used by run_personal.
    Do not silently skip this — the personal history is incomplete until it runs.
"""
from __future__ import annotations

ARCHIVE_SEASONS = [
    ("2020-21", 2020, "no_xg"),
    ("2021-22", 2021, "no_xg"),
    ("2022-23", 2022, "full_xg"),
    ("2023-24", 2023, "full_xg"),
    ("2024-25", 2024, "full_xg"),
]

VAASTAV_BASE = (
    "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
)


def run(client, dry_run: bool = False) -> None:
    # TODO(archive): after loading archive seasons into fpl.seasons, back-fill the
    # deferred past-season personal rows from the cached entry history — see the
    # module docstring above.
    raise NotImplementedError("Archive ingestion not yet implemented — Phase 0 step 3")
