"""GW1 draft tool — the stripped-down, backtest-honest version.

The projection layer was pre-registered and REFUTED (draft_backtest: naive beats
projection -377 and template-as-constraint -180, 0/5 each). So this tool is
deliberately simple and is a JUDGEMENT AID, not an oracle:

  - Core = naive-optimal ILP: the legal 15 maximising last-season TOTAL points
    (the method that actually won). It emergently reproduces the Study 7 shape.
  - Study 7 template = a DISPLAYED LENS, never a constraint.
  - Fixture info = context shown alongside, never in the objective.
  - Per chosen player: near-miss, similar-price ALTERNATIVES with their numbers,
    so pre-season judgement (injuries, signings, role changes) is applied against
    real options — the optimum is fragile and small metric changes reshuffle it.
  - Tier-C (no prior) newcomers: a prominent watchlist. Usually 0-6% of the
    GW1-10 ceiling but 19% in 2022/23 (Haaland's debut) — rarely load-bearing,
    occasionally decisive. Never ranked at 0; surfaced for your judgement.
  - Flags per row: moved club / stale (older) prior / promoted / limited data.
  - Manual-include override retained (force players in).
"""
from __future__ import annotations

from collections import Counter, defaultdict

from ingest import query
from analysis import optimizer as O
from analysis import draft_projection as DP
from analysis import params as P

# Study 7 recurring template (reference means — a lens, not a target)
TEMPLATE_REF = {"mean_price": {"GKP": 4.9, "DEF": 5.2, "MID": 7.8, "FWD": 8.4},
                "cheap_def_share_lt5": 0.30, "premium_attackers_ge10": "1-2",
                "nailed_share": 0.88}
ALT_PRICE_LO, ALT_PRICE_HI, ALT_N = 1.0, 0.5, 3     # similar-price alternative window

FRAMING = ("Strong data-driven core from proven players; the gap to the ceiling is "
           "newcomers and in-season adaptation, not cleverer GW1 projection.")


def _flags(m, prev_season):
    if m["tier"] == "C":
        return ["NO-DATA(forced)"] + (["promoted"] if m.get("promoted_club") else [])
    f = []
    if m["tier"] == "B":
        f.append("limited-data")
    if m.get("prior_season") and m["prior_season"] != prev_season:
        f.append(f"old-prior:{m['prior_season']}")
    if m.get("pos_changed"):
        f.append(f"pos-changed:{m.get('prior_pos')}->prior")   # ppg_per_start prior is mis-scored
    if m.get("moved_club"):
        f.append("moved-club")
    if m.get("promoted_club"):
        f.append("promoted")
    return f


def build(client, target_season: str, force_include_names=None):
    pr = DP.build(client, target_season)
    cands, meta, last_total = pr["candidates"], pr["meta"], pr["last_total"]
    prev_season = DP.prev_season(target_season)
    short = {r["id"]: r["short_name"] for r in query.fetch_all(
        client, "teams", "id, short_name", filters={"season_id": target_season})}
    byid = {p["id"]: p for p in cands}

    force_ids = set()
    if force_include_names:
        want = {n.strip().lower() for n in force_include_names}
        force_ids = {i for i in meta if meta[i]["name"].lower() in want}
        # allow forcing Tier-C (no-prior) players too — they are NOT in the candidate
        # pool, so add them at nominal value 0 (their price still frees/consumes budget,
        # letting the ILP re-optimise the rest around them). This is the honest
        # manual-include path for newcomers the model cannot see.
        tierc_by_name = {t["name"].lower(): t for t in pr["tierC"]}
        for n in want:
            t = tierc_by_name.get(n)
            if t and t["id"] not in force_ids:
                cands.append({"id": t["id"], "position": t["pos"], "price": t["price"], "club": t["club"]})
                last_total[t["id"]] = 0
                meta[t["id"]] = {"name": t["name"], "tier": "C", "prior_season": None,
                                 "start_rate": None, "ppg_started": None, "moved_club": None,
                                 "promoted_club": t.get("promoted_club"), "pos_changed": False,
                                 "prior_pos": None}
                byid[t["id"]] = cands[-1]
                force_ids.add(t["id"])

    opt = O.solve_squad_by_value(cands, last_total, force_include=force_ids or None)
    chosen = set(opt.player_ids)

    # per-position candidate pools (by last-season total desc)
    pool = defaultdict(list)
    for p in cands:
        pool[p["position"]].append(p["id"])
    for pos in pool:
        pool[pos].sort(key=lambda i: last_total.get(i, 0), reverse=True)

    def row(i):
        p, m = byid[i], meta[i]
        return {"id": i, "name": m["name"], "pos": p["position"], "price": p["price"],
                "club": short.get(p["club"], "?"), "last_total": last_total.get(i, 0),
                "start_rate": m["start_rate"] if m["start_rate"] is not None else "—",
                "ppg_started": m["ppg_started"] if m["ppg_started"] is not None else "—",
                "fix_ctx": pr["fixture_ctx"].get(p["club"], 0.0), "flags": _flags(m, prev_season)}

    # chosen 15 with similar-price near-miss alternatives per player
    squad = []
    for i in sorted(chosen, key=lambda x: (("GKP","DEF","MID","FWD").index(byid[x]["position"]),
                                           -byid[x]["price"])):
        r = row(i)
        lo, hi = r["price"] - ALT_PRICE_LO, r["price"] + ALT_PRICE_HI
        alts = [row(j) for j in pool[r["pos"]]
                if j not in chosen and lo <= byid[j]["price"] <= hi][:ALT_N]
        r["alternatives"] = alts
        squad.append(r)

    # template lens (emergent shape vs Study 7 reference)
    by_pos = defaultdict(list)
    for r in squad:
        by_pos[r["pos"]].append(r)
    lens = {"mean_price": {pos: round(sum(x["price"] for x in rs) / len(rs), 1)
                           for pos, rs in by_pos.items()},
            "cheap_def_share_lt5": round(sum(1 for r in by_pos["DEF"] if r["price"] < 5.0)
                                         / len(by_pos["DEF"]), 2),
            "premium_attackers_ge10": sum(1 for r in squad
                                          if r["pos"] in ("MID", "FWD") and r["price"] >= 10.0),
            "nailed_share": round(sum(1 for i in chosen if i in pr["nailed_ids"]) / 15, 2)}

    # Tier-C watchlist (prominent; sort by price as market-expectation proxy)
    tierc = sorted(pr["tierC"], key=lambda t: -t["price"])
    for t in tierc:
        t["club_short"] = short.get(t["club"], "?")

    return {"target_season": target_season, "framing": FRAMING, "spend": opt.spend,
            "status": opt.status, "squad": squad, "template_lens": lens,
            "template_ref": TEMPLATE_REF, "tierC": tierc,
            "n_candidates": len(cands), "n_tierC": len(pr["tierC"]),
            "forced": sorted(meta[i]["name"] for i in force_ids)}
