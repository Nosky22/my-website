"""Small, dependency-free statistics for the correlation studies.

No numpy/scipy (kept out of the pipeline deliberately). Spearman rank
correlation with a Fisher-z confidence interval (Fieller's 1.03/sqrt(n-3)
Spearman correction) — fast and standard, so thin cells show wide bars.
"""
from __future__ import annotations

import math


def _rank(values: list[float]) -> list[float]:
    """Fractional ranks (ties averaged)."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float:
    n = len(xs)
    if n < 3:
        return float("nan")
    rx, ry = _rank(xs), _rank(ys)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    sx = math.sqrt(sum((r - mx) ** 2 for r in rx))
    sy = math.sqrt(sum((r - my) ** 2 for r in ry))
    return cov / (sx * sy) if sx and sy else float("nan")


def spearman_ci(rho: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """Fisher-z CI with the Spearman variance inflation (1 + rho^2/2)/(n-3)."""
    if n <= 4 or math.isnan(rho) or abs(rho) >= 1.0:
        return (float("nan"), float("nan"))
    zr = math.atanh(rho)
    se = math.sqrt((1.0 + rho ** 2 / 2.0) / (n - 3))
    return (math.tanh(zr - z * se), math.tanh(zr + z * se))


def spearman_full(xs: list[float], ys: list[float]) -> dict:
    """{rho, n, ci_lo, ci_hi} — the standard reported bundle for a factor cell."""
    n = len(xs)
    rho = spearman(xs, ys)
    lo, hi = spearman_ci(rho, n)
    return {"rho": None if math.isnan(rho) else round(rho, 3),
            "n": n,
            "ci95": [None if math.isnan(lo) else round(lo, 3),
                     None if math.isnan(hi) else round(hi, 3)]}


def group_means(labels: list, values: list[float]) -> dict:
    """Mean value per group label → {label: (mean, n)}."""
    agg: dict = {}
    for lab, v in zip(labels, values):
        agg.setdefault(lab, []).append(v)
    return {lab: (round(sum(vs) / len(vs), 3), len(vs)) for lab, vs in agg.items()}


def mean_diff(group_a: list[float], group_b: list[float]) -> dict:
    """Two-group comparison (e.g. home vs away): means, delta, Cohen's d, n's."""
    na, nb = len(group_a), len(group_b)
    if na < 2 or nb < 2:
        return {"mean_a": None, "mean_b": None, "delta": None, "cohens_d": None,
                "n_a": na, "n_b": nb}
    ma, mb = sum(group_a) / na, sum(group_b) / nb
    va = sum((x - ma) ** 2 for x in group_a) / (na - 1)
    vb = sum((x - mb) ** 2 for x in group_b) / (nb - 1)
    sp = math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2))
    d = (ma - mb) / sp if sp else None
    return {"mean_a": round(ma, 3), "mean_b": round(mb, 3),
            "delta": round(ma - mb, 3),
            "cohens_d": round(d, 3) if d is not None else None,
            "n_a": na, "n_b": nb}


# Cell-size honesty thresholds (flag correlations from thin cells as noise)
THIN_CELL = 100      # below this, treat a correlation as suggestive at best
NOISE_CELL = 30      # below this, do not interpret at all
