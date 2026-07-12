"""Safe Supabase read helpers for the fpl schema.

PostgREST caps every row-select at 1000 rows by default. A bare `.execute()`
on a select therefore silently returns AT MOST 1000 rows — the recurring bug
that has bitten this pipeline more than once (verification and readback queries
that looked complete but only saw the first page).

ALWAYS read through these helpers:
  * fetch_all()   — paginates via .range() until the result set is exhausted
  * exact_count() — counts via the count header (never returns row data)

Never call `.execute()` on a bare row-select whose result could exceed 1000
rows. If you need every row → fetch_all. If you need a total → exact_count.
If you genuinely want a bounded slice → use `.order(...).limit(n)` explicitly
so the truncation is intentional and visible.

Filters are passed as a dict of column → value. The sentinel `query.NULL` as a
value means "column IS NULL" (for null-rate counts).
"""
from __future__ import annotations

PAGE = 1000  # PostgREST hard default per request
NULL = "__null__"  # filters sentinel meaning "column IS NULL"


def _apply(q, filters: dict | None):
    for col, val in (filters or {}).items():
        q = q.is_(col, "null") if val == NULL else q.eq(col, val)
    return q


def fetch_all(
    client,
    table: str,
    columns: str,
    *,
    filters: dict | None = None,
    order: str = "id",
) -> list[dict]:
    """Every row matching `filters`, paginated past the 1000-row cap.

    Uses .range() with a stable `order` key so pages don't overlap or skip.
    """
    rows: list[dict] = []
    start = 0
    while True:
        q = client.schema("fpl").table(table).select(columns)
        q = _apply(q, filters)
        q = q.order(order).range(start, start + PAGE - 1)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        start += PAGE
    return rows


def exact_count(client, table: str, *, filters: dict | None = None) -> int:
    """Row count via the count header — never truncated, never returns rows."""
    q = client.schema("fpl").table(table).select("id", count="exact")
    q = _apply(q, filters)
    return q.execute().count
