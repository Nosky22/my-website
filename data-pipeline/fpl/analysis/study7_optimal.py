"""Study 7 — retrospective set-and-forget optimal squad (the hindsight ceiling).

Uses the ILP core (`optimizer.py`). Per season: the best legal 15 at GW1 prices,
unchanged all year, playing the optimal XI + captain each GW. Reports:
  1. the ceiling squad + season points;
  2. how far real managers fell short (2025/26 only — the sole season with
     elite-cohort + personal data);
  3. the CROSS-SEASON ARCHETYPE PATTERN — which KINDS of players recur (this is
     the legitimate GW1-drafting signal; asking "what kinds", not "which names").

HONEST CAVEAT (recorded): this is a HINDSIGHT ceiling, not an achievable target.
Nobody picks it ex ante. Value = a benchmark and an archetype signal, nothing more.

Tractability: XI/captain vars are created only for a generous per-position top-K
by season points (`START_K`); a squad's 4 benched slots are always its lowest
contributors, so non-top-K players only ever serve as cheap bench fillers (they
keep a squad var). K-stability is checked in the runner. The ILP still returns a
proven optimum for the given candidate set (status Optimal).
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict

from ingest import query
from analysis import optimizer as O
from analysis import params as P

START_K = 45           # XI candidates per position (generous; K-stability checked)
PRICE_BANDS = (("<4.5", 4.5), ("4.5-5.5", 5.5), ("5.5-7.0", 7.0),
               ("7.0-9.0", 9.0), (">=9.0", 999.0))


def _band(price):
    for name, hi in PRICE_BANDS:
        if price < hi:
            return name
    return PRICE_BANDS[-1][0]


def assemble_season(client, season):
    """Return (players_meta, points, gws, candidates, startable). candidates =
    players present at GW1 (price + club from the GW1 fixture)."""
    meta = {r["id"]: {"pos": r["position"], "name": r["web_name"], "team_id": r["team_id"]}
            for r in query.fetch_all(client, "players",
                "id, position, web_name, team_id", filters={"season_id": season})}
    fx = {f["id"]: f for f in query.fetch_all(client, "fixtures",
            "id, home_team_id, away_team_id, gw_number", filters={"season_id": season})}

    points = defaultdict(lambda: defaultdict(float))
    gw1_price, gw1_club = {}, {}
    gws_seen = set()
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, fixture_id, was_home, total_points, value",
            filters={"season_id": season}):
        pid, gw = r["player_id"], r["gw_number"]
        points[pid][gw] += r["total_points"] or 0
        gws_seen.add(gw)
        if gw == 1 and r["value"] is not None and r["was_home"] is not None:
            f = fx.get(r["fixture_id"])
            if f:
                gw1_price[pid] = float(r["value"])
                gw1_club[pid] = f["home_team_id"] if r["was_home"] else f["away_team_id"]

    gws = sorted(gws_seen)
    candidates = []
    for pid in gw1_price:
        if pid in meta and meta[pid]["pos"] in O.POSITIONS:
            candidates.append({"id": pid, "position": meta[pid]["pos"],
                               "price": gw1_price[pid], "club": gw1_club[pid]})
    # startable = top-K per position by season total
    total = {pid: sum(points[pid].values()) for pid in points}
    startable = set()
    for q in O.POSITIONS:
        pool = sorted((c["id"] for c in candidates if c["position"] == q),
                      key=lambda i: total.get(i, 0), reverse=True)
        startable.update(pool[:START_K])
    plain_points = {pid: dict(g) for pid, g in points.items()}
    return meta, plain_points, gws, candidates, startable


def _promoted_codes(client, season):
    """team codes newly present this season vs the previous recorded season."""
    idx = P.RECORDED_SEASONS.index(season)
    if idx == 0:
        return None
    prev = P.RECORDED_SEASONS[idx - 1]
    def codes(s):
        return {(r["fpl_team_id"], r["code"]) for r in query.fetch_all(
            client, "teams", "fpl_team_id, code", filters={"season_id": s})}
    now = codes(season); before = {c for _, c in codes(prev)}
    return {tid for tid, code in now if code not in before}


def _archetypes(client, season):
    return {r["player_id"]: r["archetype"] for r in query.fetch_all(
        client, "player_archetypes", "player_id, archetype",
        filters={"season_id": season})}


def solve_season(client, season, start_k=START_K):
    meta, points, gws, candidates, startable = assemble_season(client, season)
    sol = O.solve_set_and_forget(candidates, points, gws, startable=startable,
                                 time_limit=180)
    arch = _archetypes(client, season)
    promoted = _promoted_codes(client, season)
    price = {c["id"]: c["price"] for c in candidates}
    club = {c["id"]: c["club"] for c in candidates}
    squad = []
    for pid in sol.player_ids:
        squad.append({
            "id": pid, "name": meta[pid]["name"], "pos": meta[pid]["pos"],
            "price": price[pid], "club": club[pid],
            "archetype": arch.get(pid),
            "promoted": (club[pid] in promoted) if promoted is not None else None,
            "season_pts": round(sum(points.get(pid, {}).values()), 0),
        })
    squad.sort(key=lambda r: (O.POSITIONS.index(r["pos"]), -r["price"]))
    return sol, squad


def manager_benchmark(client, season):
    """Season-total gap vs real managers. Only 2025/26 has cohort + personal data."""
    mg = query.fetch_all(client, "manager_gameweeks",
        "manager_entry_id, gw_number, total_points", filters={"season_id": season})
    if not mg:
        return None
    final = {}
    for r in mg:
        k = r["manager_entry_id"]
        if r["total_points"] is not None and (k not in final or r["gw_number"] > final[k][0]):
            final[k] = (r["gw_number"], r["total_points"])
    elite = sorted(v[1] for v in final.values())
    me_rows = query.fetch_all(client, "my_entry_gameweeks",
        "gw_number, total_points", filters={"season_id": season})
    me = max((r["total_points"] for r in me_rows if r["total_points"] is not None),
             default=None)
    return {"n_elite": len(elite), "elite_best": elite[-1] if elite else None,
            "elite_median": round(statistics.median(elite)) if elite else None,
            "me": me}


def cross_season_pattern(all_squads):
    """Aggregate the KINDS of players across the retrospective-optimal squads."""
    arche = Counter()
    band_by_pos = defaultdict(Counter)
    price_by_pos = defaultdict(list)
    promoted_n = promoted_known = 0
    for season, squad in all_squads.items():
        for r in squad:
            if r["archetype"]:
                arche[r["archetype"]] += 1
            band_by_pos[r["pos"]][_band(r["price"])] += 1
            price_by_pos[r["pos"]].append(r["price"])
            if r["promoted"] is not None:
                promoted_known += 1
                promoted_n += int(r["promoted"])
    return {
        "archetype_distribution": dict(arche),
        "price_band_by_position": {p: dict(c) for p, c in band_by_pos.items()},
        "mean_price_by_position": {p: round(statistics.mean(v), 2)
                                   for p, v in price_by_pos.items()},
        "cheap_def_share": _cheap_def_share(all_squads),
        "promoted_share": (round(promoted_n / promoted_known, 3)
                           if promoted_known else None),
        "promoted_count": promoted_n, "promoted_known_seasons_slots": promoted_known,
    }


def _cheap_def_share(all_squads):
    defs = [r for sq in all_squads.values() for r in sq if r["pos"] == "DEF"]
    cheap = [r for r in defs if r["price"] < 5.0]
    return round(len(cheap) / len(defs), 3) if defs else None
