"""vaastav Fantasy-Premier-League archive ingestion (2020/21–2024/25).

Phase 0 priority 3 — implement after live 2025/26 capture is verified.
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
    raise NotImplementedError("Archive ingestion not yet implemented — Phase 0 step 3")
