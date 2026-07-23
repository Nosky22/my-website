"""Study 6, Phase B — the OWNERSHIP / MISPRICING term, on the honest ppg base.

Phase A settled the point estimate: hold-value IS season-to-date ppg (engineered
xPts adds +0.000 at the t+1..t+6 hold). So the search for edge moves here — does
knowing what the FIELD owns add anything on top of ppg?

Two DISTINCT questions (pre-registered thresholds below, fixed before measuring):

 (a) PREDICTIVE — does an ownership term add beyond ppg for predicting subsequent
     returns?  Partial Spearman(ownership, subsequent | ppg). For the UNDERVALUATION
     thesis we need it NEGATIVE (low ownership -> higher residual return). Study 2
     said raw ownership rho~0.1, so expect ~null after controlling ppg. Testing
     it properly anyway.

 (b) MISPRICING — are there identifiable player TYPES the field systematically
     under-owns relative to expected returns? (archetype / price band / position /
     fixture-adjusted team strength). A category-level bias can exist even if
     player-level ownership barely predicts. Decision-relevant confirmation: does a
     "high-ppg + low-ownership" portfolio out-return "high-ppg" alone on subsequent
     points? Hit-rate vs 50% base rate.

Plus a FALSE-POSITIVE GUARD (independent pass/fail): the top-20 ex-ante
undervaluation picks per season must NOT be dominated by rotation-risk players the
Study 5 nailed-ness guard should catch.

OWNERSHIP DATA: multi-season. Archive seasons (2020/21-2024/25) have no DB
selected_by; we read the raw vaastav `selected` COUNT from merged_gw.csv. 2025/26
uses the DB selected_by. The two sources use different denominators (raw counts vs
%, and the manager base grows season to season) -> we NEVER pool raw values. Every
value is converted to a WITHIN-GW PERCENTILE among the decision set before pooling.
Percentile is a monotonic rank transform, so count-vs-% and base-size differences
vanish. Confirmed in `_add_pctile`.
"""
from __future__ import annotations

import csv
import os
import statistics
from collections import defaultdict

from ingest import query
from analysis import stats
from analysis import params as P
from analysis import study6_xpts as A

HORIZON = 6                       # the hold horizon Phase A settled on
RAW_DIR = os.path.join(os.path.dirname(__file__), "..", "raw")

# ── PRE-REGISTERED SUCCESS CRITERIA (fixed before any number is seen) ─────────
N_SEASONS = 6                     # 2020/21..2025/26, ownership available for all
CONSISTENCY = 4                   # >= this many of 6 seasons must agree

PRED_MIN_ABS = 0.05               # (a) |partial rho| must clear this to "add"
                                  #     and be NEGATIVE for the undervaluation thesis
MISPRICE_DIFF = 0.10              # (b) category mean(ret_pct - own_pct) threshold
MISPRICE_MIN_N = 50               # (b) min category rows per season to count it
PORT_TERCILE = 3                  # high-ppg pool = top 1/3 by base_ppg within GW
GUARD_TOPN = 20                   # (guard) picks per season inspected
GUARD_MAX_RISK = 0.50             # (guard) rotation+fringe share must stay <= this


# ── ownership recovery ───────────────────────────────────────────────────────

def _archive_ownership(client, season):
    """{(player_id, gw): selected_count} from raw vaastav merged_gw.csv."""
    pmap = {r["fpl_element_id"]: r["id"] for r in query.fetch_all(
        client, "players", "id, fpl_element_id", filters={"season_id": season})}
    path = os.path.join(RAW_DIR, season, "merged_gw.csv")
    out = {}
    with open(path, encoding="utf-8") as f:
        for h in csv.DictReader(f):
            pid = pmap.get(int(h["element"]))
            if pid is None:
                continue
            try:
                out[(pid, int(h["round"]))] = int(h["selected"])   # same across a DGW
            except (ValueError, KeyError):
                continue
    return out


def _db_ownership(client, season):
    """{(player_id, gw): selected_by} from DB (2025/26 has the live column)."""
    out = {}
    for r in query.fetch_all(client, "player_gameweeks",
            "player_id, gw_number, selected_by", filters={"season_id": season}):
        if r["selected_by"] is None:
            continue
        v = float(r["selected_by"])
        k = (r["player_id"], r["gw_number"])
        out[k] = max(out.get(k, v), v)     # DGW: same snapshot, keep one
    return out


def ownership_map(client, season):
    db = _db_ownership(client, season)
    return db if db else _archive_ownership(client, season)


# ── percentile helper ────────────────────────────────────────────────────────

def _add_pctile(rows, src, dst):
    """dst = within-group percentile of src in [0,1] (0=lowest). Ties -> midrank.
    Monotonic rank transform: pools raw counts and %s comparably."""
    vals = sorted(r[src] for r in rows)
    n = len(vals)
    for r in rows:
        v = r[src]
        lo = sum(1 for x in vals if x < v)
        eq = sum(1 for x in vals if x == v)
        r[dst] = (lo + 0.5 * eq) / n if n else 0.5


# ── assembly ─────────────────────────────────────────────────────────────────

def build_rows(client):
    """Per decision point t: base_ppg, subsequent target (t+1..t+H), ownership,
    archetype, price, fixture-adjusted rel-ELO. Percentiles computed WITHIN
    (season, gw) over the decision set (established players with a ppg)."""
    arch = {(r["season_id"], r["player_id"]): r["archetype"] for r in query.fetch_all(
        client, "player_archetypes", "season_id, player_id, archetype", filters={})}
    all_rows = []
    for s in P.RECORDED_SEASONS:
        own = ownership_map(client, s)
        base = A.assemble_features(client, s, HORIZON)   # ppg baseline universe
        rows = []
        for r in base:
            sel = own.get((r["player_id"], r["gw"]))
            if sel is None:
                continue
            r["selected"] = sel
            r["arch"] = arch.get((s, r["player_id"]))
            r["price"] = (r["base_ppg"] / r["ppm"]) if r.get("ppm") else None
            rows.append(r)
        bygw = defaultdict(list)
        for r in rows:
            bygw[r["gw"]].append(r)
        for grp in bygw.values():
            _add_pctile(grp, "selected", "own_pct")
            _add_pctile(grp, "target", "ret_pct")
            _add_pctile(grp, "base_ppg", "ppg_pct")
        all_rows += rows
    return all_rows


# ── partial Spearman ─────────────────────────────────────────────────────────

def _partial(o, t, b):
    """partial Spearman(o, t | b)."""
    r_ot = stats.spearman(o, t)
    r_ob = stats.spearman(o, b)
    r_tb = stats.spearman(t, b)
    denom = ((1 - r_ob ** 2) * (1 - r_tb ** 2)) ** 0.5
    return (r_ot - r_ob * r_tb) / denom if denom > 1e-9 else 0.0


# ── the three tests ──────────────────────────────────────────────────────────

def test_a_predictive(rows):
    """(a) Does ownership add beyond ppg? partial rho(own, subsequent | ppg)."""
    out = {"pooled": {}, "per_season": {}}
    def cell(sub):
        return _partial([r["own_pct"] for r in sub], [r["target"] for r in sub],
                        [r["base_ppg"] for r in sub]) if len(sub) > 30 else None
    out["pooled"]["ALL"] = round(cell(rows), 4)
    for pos in A.POSITIONS:
        out["pooled"][pos] = round(cell([r for r in rows if r["pos"] == pos]) or 0, 4)
    signs = 0
    for s in P.RECORDED_SEASONS:
        c = cell([r for r in rows if r["season"] == s])
        out["per_season"][s] = round(c, 4) if c is not None else None
        if c is not None and c < 0:
            signs += 1
    pooled = out["pooled"]["ALL"]
    out["neg_seasons"] = signs
    out["verdict"] = (
        "ADDS (undervaluation direction)" if pooled is not None and pooled <= -PRED_MIN_ABS
        and signs >= CONSISTENCY else
        "ADDS (WRONG direction: owned do better)" if pooled is not None and pooled >= PRED_MIN_ABS
        else "NULL — no incremental signal beyond ppg")
    return out


def test_b_mispricing(rows):
    """(b) category-level under-ownership relative to returns + decision portfolio."""
    def band_price(p):
        if p is None: return None
        return "<5.0" if p < 5 else "5.0-7.5" if p < 7.5 else "7.5-10" if p < 10 else ">=10"
    # fixture-adjusted team-strength tercile within season
    for s in P.RECORDED_SEASONS:
        sub = [r for r in rows if r["season"] == s]
        vals = sorted(r["rel_elo"] for r in sub)
        if not vals: continue
        lo, hi = vals[len(vals)//3], vals[2*len(vals)//3]
        for r in sub:
            r["elo_band"] = "weak" if r["rel_elo"] < lo else "strong" if r["rel_elo"] >= hi else "mid"

    cats = {"archetype": lambda r: r["arch"], "position": lambda r: r["pos"],
            "price_band": lambda r: band_price(r["price"]), "team_strength": lambda r: r.get("elo_band")}
    mispriced = {}
    for name, key in cats.items():
        catvals = sorted({key(r) for r in rows if key(r) is not None},
                         key=lambda x: str(x))
        mispriced[name] = {}
        for cv in catvals:
            per_season, hits = [], 0
            for s in P.RECORDED_SEASONS:
                sub = [r for r in rows if r["season"] == s and key(r) == cv]
                if len(sub) < MISPRICE_MIN_N:
                    per_season.append(None); continue
                diff = statistics.mean(r["ret_pct"] - r["own_pct"] for r in sub)
                per_season.append(round(diff, 3))
                if diff >= MISPRICE_DIFF:
                    hits += 1
            pooled_sub = [r for r in rows if key(r) == cv]
            mispriced[name][str(cv)] = {
                "pooled_diff": round(statistics.mean(
                    r["ret_pct"] - r["own_pct"] for r in pooled_sub), 3),
                "n_pooled": len(pooled_sub),
                "seasons_over_thresh": hits,
                "per_season": per_season,
                "PASS": hits >= CONSISTENCY,
            }
    return mispriced


def portfolio(rows):
    """Decision test: high-ppg vs high-ppg+low-ownership, subsequent points."""
    out = {}
    lo_ge_pool = lo_ge_hi = 0
    for s in P.RECORDED_SEASONS:
        sub = [r for r in rows if r["season"] == s]
        # high-ppg pool = top tercile by ppg_pct
        pool = [r for r in sub if r["ppg_pct"] >= 1 - 1.0 / PORT_TERCILE]
        if len(pool) < 30:
            out[s] = None; continue
        med_own = statistics.median(r["own_pct"] for r in pool)
        low = [r for r in pool if r["own_pct"] <= med_own]
        high = [r for r in pool if r["own_pct"] > med_own]
        pool_mean = statistics.mean(r["target"] for r in pool)
        pool_med = statistics.median(r["target"] for r in pool)
        low_mean = statistics.mean(r["target"] for r in low)
        high_mean = statistics.mean(r["target"] for r in high) if high else 0
        hit = statistics.mean(1 if r["target"] > pool_med else 0 for r in low)
        out[s] = {"n_pool": len(pool), "pool_mean": round(pool_mean, 2),
                  "lowown_mean": round(low_mean, 2), "highown_mean": round(high_mean, 2),
                  "hit_rate_vs50": round(hit, 3)}
        if low_mean >= pool_mean: lo_ge_pool += 1
        if low_mean >= high_mean: lo_ge_hi += 1
    out["lowown_ge_pool_seasons"] = lo_ge_pool
    out["lowown_ge_highown_seasons"] = lo_ge_hi
    out["PASS_outperform"] = lo_ge_pool >= CONSISTENCY
    return out


def guard(rows):
    """Top-20 ex-ante undervaluation picks/season (high ppg_pct, low own_pct);
    archetype composition. PASS if rotation+fringe share <= 50% in >=4/6 seasons."""
    out = {}
    ok = 0
    for s in P.RECORDED_SEASONS:
        sub = [r for r in rows if r["season"] == s and r["arch"] is not None]
        # best (highest ppg_pct - own_pct) row per player
        best = {}
        for r in sub:
            score = r["ppg_pct"] - r["own_pct"]
            if r["player_id"] not in best or score > best[r["player_id"]][0]:
                best[r["player_id"]] = (score, r)
        top = sorted(best.values(), key=lambda x: -x[0])[:GUARD_TOPN]
        comp = defaultdict(int)
        for _, r in top:
            comp[r["arch"]] += 1
        n = sum(comp.values())
        risk = (comp.get("rotation", 0) + comp.get("fringe", 0)) / n if n else 0
        out[s] = {"n": n, "nailed": comp.get("nailed", 0),
                  "rotation": comp.get("rotation", 0), "fringe": comp.get("fringe", 0),
                  "risk_share": round(risk, 2)}
        if risk <= GUARD_MAX_RISK:
            ok += 1
    out["clean_seasons"] = ok
    out["PASS"] = ok >= CONSISTENCY
    return out
