"""Unit tests for the squad ILP core. Constraint correctness is the point.

Run directly:  python -m analysis.test_optimizer   (plain asserts, no pytest needed)
Also pytest-discoverable (def test_*).
"""
from __future__ import annotations

from analysis import optimizer as O


def _fixture():
    """A small but complete, feasible instance: 3 GKP / 8 DEF / 8 MID / 6 FWD
    across spread clubs, cheap enough to fit budget. Points rise with index so a
    best XI exists; one player is a runaway captain pick."""
    players, points = [], {}
    def add(pid, position, price, club, per_gw):
        players.append({"id": pid, "position": position, "price": price, "club": club})
        points[pid] = {g: per_gw for g in (1, 2)}
    i = 0
    layout = [("GKP", 3), ("DEF", 8), ("MID", 8), ("FWD", 6)]
    for q, n in layout:
        for k in range(n):
            i += 1
            add(i, q, 4.0, (k % 8) + 1, per_gw=float(k))   # club spread, rising pts
    return players, points


def test_squad_structure_and_budget_and_club():
    players, points = _fixture()
    sol = O.solve_set_and_forget(players, points, [1, 2], time_limit=30)
    assert sol.status == "Optimal", sol.status
    assert len(sol.player_ids) == 15
    pos = {p["id"]: p["position"] for p in players}
    club = {p["id"]: p["club"] for p in players}
    from collections import Counter
    pc = Counter(pos[i] for i in sol.player_ids)
    assert dict(pc) == {"GKP": 2, "DEF": 5, "MID": 5, "FWD": 3}, dict(pc)
    assert sol.spend <= O.BUDGET + 1e-6
    cc = Counter(club[i] for i in sol.player_ids)
    assert max(cc.values()) <= O.MAX_PER_CLUB, dict(cc)


def test_xi_formation_and_captain_each_gw():
    players, points = _fixture()
    sol = O.solve_set_and_forget(players, points, [1, 2], time_limit=30)
    pos = {p["id"]: p["position"] for p in players}
    for g in (1, 2):
        xi = sol.lineups[g]
        assert len(xi) == O.XI_SIZE, (g, len(xi))
        assert set(xi) <= set(sol.player_ids)          # start only owned
        from collections import Counter
        fc = Counter(pos[i] for i in xi)
        assert fc["GKP"] == 1
        assert O.XI_MIN["DEF"] <= fc["DEF"] <= O.XI_MAX["DEF"]
        assert O.XI_MIN["MID"] <= fc["MID"] <= O.XI_MAX["MID"]
        assert O.XI_MIN["FWD"] <= fc["FWD"] <= O.XI_MAX["FWD"]
        assert sol.captains[g] in xi                   # captain must be a starter


def test_captain_picks_the_max_scorer():
    """A runaway scorer in GW1 must be the captain (doubling)."""
    players, points = _fixture()
    star = players[-1]["id"]          # last FWD, currently modest pts
    points[star][1] = 100.0           # runaway in GW1 only
    sol = O.solve_set_and_forget(players, points, [1, 2], time_limit=30)
    assert star in sol.player_ids, "star must be selected"
    assert sol.captains[1] == star, (sol.captains[1], star)


def test_startable_reduction_matches_full_model():
    """A generous startable set must not change the optimum vs the full model."""
    players, points = _fixture()
    full = O.solve_set_and_forget(players, points, [1, 2], time_limit=30)
    # startable = everyone who ever scored > 0 (bench fillers excluded from XI)
    startable = {i for i in points if max(points[i].values()) > 0}
    red = O.solve_set_and_forget(players, points, [1, 2], startable=startable, time_limit=30)
    assert red.total_points == full.total_points, (red.total_points, full.total_points)


def test_score_fixed_squad_hand_computed():
    """Hand-checkable: a legal 15 with known GW points -> known ceiling score."""
    players, points = [], {}
    # 2 GK, 5 DEF, 5 MID, 3 FWD. One GW. Points chosen so the XI is unambiguous.
    def add(pid, q, club, pts1):
        players.append({"id": pid, "position": q, "price": 4.0, "club": club})
        points[pid] = {1: pts1}
    # GKP: 6, 1(bench)   DEF: 7,6,5,4,1  MID: 9,8,7,6,2  FWD: 10,8,3
    specs = [("GKP", [6, 1]), ("DEF", [7, 6, 5, 4, 1]),
             ("MID", [9, 8, 7, 6, 2]), ("FWD", [10, 8, 3])]
    pid = 0
    for q, vals in specs:
        for v in vals:
            pid += 1
            add(pid, q, (pid % 8) + 1, v)
    ids = [p["id"] for p in players]
    # XI = 11 TOTAL = 1 GK + 10 outfield. Maximise 10 outfield s.t.
    # DEF in [3,5], MID in [2,5], FWD in [1,3].
    # outfield pts desc: 10(F),9(M),8(M),8(F),7(D),7(M),6(D),6(M),5(D),4(D) | 3(F),2(M),1(D)
    # top-10 outfield = {F10,M9,M8,F8,D7,M7,D6,M6,D5,D4} -> DEF4,MID4,FWD2 = 4-4-2, valid.
    #   outfield = 10+9+8+8+7+7+6+6+5+4 = 70 ; + GK6 = 76 ; captain = 10 -> +10 = 86.
    score = O.score_fixed_squad(ids, players, points, [1])
    assert score == 86.0, score


def main():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"  PASS  {t.__name__}")
    print(f"\nall {len(tests)} optimizer tests passed.")


if __name__ == "__main__":
    main()
