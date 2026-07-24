"""FPL squad ILP — the reusable optimisation core (Study 7 + planner §5.10/§5.13).

Solves the retrospective SET-AND-FORGET problem: choose a legal 15-man squad at
fixed (GW1) prices that, playing the best valid XI + captain every gameweek,
maximises total season points. It is deliberately a general squad ILP so the
same core drives the transfer planner (add per-GW squad-diff constraints) and
the season-path Tier-1 draft (restrict the horizon).

Correctness of the CONSTRAINTS is the priority (unit-tested in test_optimizer.py):

  Squad (15):   2 GKP, 5 DEF, 5 MID, 3 FWD ; sum(price) <= budget ; <=3 per club.
  XI (11/GW):   exactly 1 GKP started ; DEF 3-5 ; MID 2-5 ; FWD 1-3 ; total 11 ;
                a player may start only if in the squad.
  Captain:      exactly one started player per GW, whose points are DOUBLED.

Objective:  sum_{p,g} pts[p][g] * start[p,g]  +  pts[p][g] * captain[p,g]
            (the captain term adds the extra 1x on top of the base start term).

`startable` (optional): the set of player ids allowed to appear in an XI. Passing
a generous per-position top-K keeps the model small WITHOUT changing the optimum
in practice — a squad's four benched slots are always its lowest contributors, so
players well outside the top scorers only ever serve as cheap bench fillers (they
still get a squad var, just not start/captain vars). Omit (None) for the exact,
full-size model. The returned `status`/`gap` let the caller confirm optimality.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pulp

POSITIONS = ("GKP", "DEF", "MID", "FWD")
SQUAD_QUOTA = {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}          # sums to 15
XI_MIN = {"GKP": 1, "DEF": 3, "MID": 2, "FWD": 1}               # valid formation
XI_MAX = {"GKP": 1, "DEF": 5, "MID": 5, "FWD": 3}
XI_SIZE = 11
MAX_PER_CLUB = 3
BUDGET = 100.0


@dataclass
class Squad:
    player_ids: list[int]
    total_points: float
    lineups: dict[int, list[int]] = field(default_factory=dict)   # gw -> started ids
    captains: dict[int, int] = field(default_factory=dict)        # gw -> captain id
    status: str = ""
    spend: float = 0.0


def solve_set_and_forget(
    players: list[dict],            # each: id, position, price, club
    points: dict[int, dict[int, float]],   # player_id -> {gw -> points}
    gws: list[int],
    *,
    budget: float = BUDGET,
    max_per_club: int = MAX_PER_CLUB,
    startable: set[int] | None = None,
    time_limit: int | None = 120,
) -> Squad:
    pid = [p["id"] for p in players]
    pos = {p["id"]: p["position"] for p in players}
    price = {p["id"]: float(p["price"]) for p in players}
    club = {p["id"]: p["club"] for p in players}
    pts = {i: points.get(i, {}) for i in pid}
    can_start = set(pid) if startable is None else (set(startable) & set(pid))

    m = pulp.LpProblem("set_and_forget", pulp.LpMaximize)
    squad = {i: pulp.LpVariable(f"sq_{i}", cat="Binary") for i in pid}
    start = {(i, g): pulp.LpVariable(f"st_{i}_{g}", cat="Binary")
             for i in can_start for g in gws}
    capt = {(i, g): pulp.LpVariable(f"cp_{i}_{g}", cat="Binary")
            for i in can_start for g in gws}

    # objective: started points + captain's extra 1x
    m += pulp.lpSum(pts[i].get(g, 0.0) * start[(i, g)] for (i, g) in start) \
        + pulp.lpSum(pts[i].get(g, 0.0) * capt[(i, g)] for (i, g) in capt)

    # ── squad constraints ────────────────────────────────────────────────
    m += pulp.lpSum(squad[i] for i in pid) == sum(SQUAD_QUOTA.values())
    for q in POSITIONS:
        m += pulp.lpSum(squad[i] for i in pid if pos[i] == q) == SQUAD_QUOTA[q]
    m += pulp.lpSum(price[i] * squad[i] for i in pid) <= budget
    for cl in {club[i] for i in pid}:
        m += pulp.lpSum(squad[i] for i in pid if club[i] == cl) <= max_per_club

    # ── per-GW XI + captain constraints ──────────────────────────────────
    for g in gws:
        starters_g = [i for i in can_start]
        m += pulp.lpSum(start[(i, g)] for i in starters_g) == XI_SIZE
        for q in POSITIONS:
            inq = [start[(i, g)] for i in starters_g if pos[i] == q]
            m += pulp.lpSum(inq) >= XI_MIN[q]
            m += pulp.lpSum(inq) <= XI_MAX[q]
        for i in starters_g:
            m += start[(i, g)] <= squad[i]                 # start only if owned
            m += capt[(i, g)] <= start[(i, g)]             # captain only if started
        m += pulp.lpSum(capt[(i, g)] for i in starters_g) == 1

    solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=time_limit)
    m.solve(solver)
    status = pulp.LpStatus[m.status]

    chosen = [i for i in pid if squad[i].value() and squad[i].value() > 0.5]
    lineups, captains = {}, {}
    for g in gws:
        lineups[g] = sorted(i for i in can_start
                            if start.get((i, g)) is not None and start[(i, g)].value()
                            and start[(i, g)].value() > 0.5)
        cg = [i for i in can_start if capt.get((i, g)) is not None
              and capt[(i, g)].value() and capt[(i, g)].value() > 0.5]
        captains[g] = cg[0] if cg else None
    return Squad(
        player_ids=sorted(chosen),
        total_points=round(pulp.value(m.objective) or 0.0, 1),
        lineups=lineups, captains=captains, status=status,
        spend=round(sum(price[i] for i in chosen), 1),
    )


def solve_squad_by_value(
    players: list[dict],                 # id, position, price, club
    value: dict[int, float],             # player_id -> scalar value to maximise
    *,
    budget: float = BUDGET,
    max_per_club: int = MAX_PER_CLUB,
    gk_max_price: float | None = None,
    def_max_price: float | None = None,
    nailed_ids: set[int] | None = None,
    def_nailed_min: int = 0,
    premium_min_price: float | None = None,
    premium_min_count: int = 0,
    time_limit: int | None = 60,
) -> Squad:
    """Pick the legal 15 that maximises Σ value[p] (no XI logic — a squad knapsack).

    This is what an *unaided* manager does: rank players by a single scalar and
    fill the squad. Used for the NAIVE arm (value = last-season total points) and,
    with the structural-constraint hooks, the TEMPLATE arm (the Study 7 shape:
    cheap enabler keepers, cheap nailed defence, a mega-premium attacker).
    """
    pid = [p["id"] for p in players]
    pos = {p["id"]: p["position"] for p in players}
    price = {p["id"]: float(p["price"]) for p in players}
    club = {p["id"]: p["club"] for p in players}
    nailed = nailed_ids or set()

    m = pulp.LpProblem("squad_by_value", pulp.LpMaximize)
    sq = {i: pulp.LpVariable(f"sq_{i}", cat="Binary") for i in pid}
    m += pulp.lpSum(value.get(i, 0.0) * sq[i] for i in pid)

    m += pulp.lpSum(sq[i] for i in pid) == sum(SQUAD_QUOTA.values())
    for q in POSITIONS:
        m += pulp.lpSum(sq[i] for i in pid if pos[i] == q) == SQUAD_QUOTA[q]
    m += pulp.lpSum(price[i] * sq[i] for i in pid) <= budget
    for cl in {club[i] for i in pid}:
        m += pulp.lpSum(sq[i] for i in pid if club[i] == cl) <= max_per_club

    # ── structural template constraints (only bind when the arm sets them) ──
    if gk_max_price is not None:
        m += pulp.lpSum(sq[i] for i in pid if pos[i] == "GKP" and price[i] > gk_max_price) == 0
    if def_max_price is not None:
        m += pulp.lpSum(sq[i] for i in pid if pos[i] == "DEF" and price[i] > def_max_price) == 0
    if def_nailed_min:
        m += pulp.lpSum(sq[i] for i in pid if pos[i] == "DEF" and i in nailed) >= def_nailed_min
    if premium_min_price is not None and premium_min_count:
        m += pulp.lpSum(sq[i] for i in pid
                        if pos[i] in ("MID", "FWD") and price[i] >= premium_min_price) >= premium_min_count

    m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=time_limit))
    chosen = [i for i in pid if sq[i].value() and sq[i].value() > 0.5]
    return Squad(player_ids=sorted(chosen),
                 total_points=round(sum(value.get(i, 0.0) for i in chosen), 1),
                 status=pulp.LpStatus[m.status],
                 spend=round(sum(price[i] for i in chosen), 1))


def score_fixed_squad(
    player_ids: list[int], players: list[dict],
    points: dict[int, dict[int, float]], gws: list[int],
) -> float:
    """Points a GIVEN 15 would have scored under optimal XI+captain each GW.
    Used to benchmark real managers' actual squads against the ceiling. Assumes
    the 15 is already legal; picks the best valid XI + captain per GW greedily."""
    pos = {p["id"]: p["position"] for p in players}
    owned = [i for i in player_ids]
    total = 0.0
    for g in gws:
        pl = sorted(owned, key=lambda i: points.get(i, {}).get(g, 0.0), reverse=True)
        xi = _best_valid_xi(pl, pos, points, g)
        if not xi:
            continue
        gpts = sum(points.get(i, {}).get(g, 0.0) for i in xi)
        cap = max(points.get(i, {}).get(g, 0.0) for i in xi)
        total += gpts + cap
    return round(total, 1)


def _best_valid_xi(owned_sorted, pos, points, g):
    """Greedy-then-fix: take top scorers, then enforce a legal formation."""
    xi = []
    counts = {q: 0 for q in POSITIONS}
    # 1 GK first (best keeper)
    gks = [i for i in owned_sorted if pos[i] == "GKP"]
    if not gks:
        return []
    xi.append(gks[0]); counts["GKP"] = 1
    # fill outfield minimums
    for q in ("DEF", "MID", "FWD"):
        for i in owned_sorted:
            if pos[i] == q and i not in xi and counts[q] < XI_MIN[q]:
                xi.append(i); counts[q] += 1
    # fill remaining slots by points, respecting maxima
    for i in owned_sorted:
        if len(xi) == XI_SIZE:
            break
        q = pos[i]
        if i not in xi and counts[q] < XI_MAX[q]:
            xi.append(i); counts[q] += 1
    return xi if len(xi) == XI_SIZE else []
