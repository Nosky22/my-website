"""Study 8 — elite-manager behaviour (the chip/calendar half of the surviving edge).

DESCRIPTIVE, NOT CAUSAL. 150 managers, ONE season (2025/26). You cannot show any
behaviour CAUSED success — and 123/150 arrived with NO prior top-10k track record,
so much of what they share is likely luck (survivorship). Every output says so.

Cohort = top-150 overall in 2025/26 (elite THIS season by construction, so outcome
differences within the cohort are compressed; we study BEHAVIOUR, not outcome).

Classification by PRIOR (pre-2025/26) top-10k finishes in manager_seasons:
  SC  skill-consistent : >= 2 prior top-10k   (n=10 — the better evidence)
  NT  no track record  : 0 prior top-10k      (n≈123 — may just be lucky)
  MID exactly 1 prior top-10k                 (the remainder)

Pre-registered success criteria are constants here, fixed before measuring; the
runner prints PASS/FAIL. We EXPECT nulls.

Priority (per the steer):
 1. CHIP RETURNS (within-manager): chip-week points vs that manager's own non-chip
    mean. Outcome-linked, controls for manager quality, no cross-manager causal claim.
 2. CHIP TIMING distribution, respecting the two halves (GW1-19 / GW20-38).
 3. SC vs NT behaviour — where the skill-consistent 10 differ from the 123 is the
    sharper signal (shared SC behaviour beats shared cohort behaviour as evidence).
 4. Captaincy herding, transfer frequency/hits/flip-flops. Lower priority.
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict

from ingest import query

SEASON = "2025-26"
CHIPS = ("wildcard", "freehit", "bboost", "3xc")
HALF1_LAST = 19                      # first-half chips expire after GW19

# ── PRE-REGISTERED CRITERIA (fixed before measuring) ─────────────────────────
CHIP_PAYS_MIN_SHARE = 0.60           # (1) a chip "pays" if >=60% of uses beat own baseline
CHIP_PAYS_MIN_DELTA = 0.0            #     AND mean within-manager delta > 0
TIMING_PRIOR_WINDOW = 5              # (2) usable prior if >=40% of uses fall in a <=5-GW window
TIMING_PRIOR_SHARE = 0.40
FLIPFLOP_GW = 4                      # (4) a reversal within this many GWs = flip-flop


def _prior_top10k(client):
    hist = defaultdict(list)
    for r in query.fetch_all(client, "manager_seasons",
            "manager_entry_id, season_name, overall_rank", order="id"):
        if r["season_name"] not in ("2025/26", "2025-26"):
            hist[r["manager_entry_id"]].append(r["overall_rank"])
    cls = {}
    for m, ranks in hist.items():
        n = sum(1 for rk in ranks if rk is not None and rk <= 10000)
        cls[m] = "SC" if n >= 2 else ("MID" if n == 1 else "NT")
    return cls, hist


def load(client):
    mg = query.fetch_all(client, "manager_gameweeks",
        "manager_entry_id, gw_number, chip, points, points_on_bench, "
        "event_transfers, event_transfers_cost, total_points", filters={"season_id": SEASON})
    picks = query.fetch_all(client, "manager_picks",
        "manager_entry_id, gw_number, player_id, is_captain, multiplier",
        filters={"season_id": SEASON})
    transfers = query.fetch_all(client, "manager_transfers",
        "manager_entry_id, gw_number, player_in_id, player_out_id, transfer_time",
        filters={"season_id": SEASON})
    cls, hist = _prior_top10k(client)
    for m in {r["manager_entry_id"] for r in mg}:
        cls.setdefault(m, "NT")
    return mg, picks, transfers, cls


# ── (1) chip returns, within-manager ─────────────────────────────────────────

def chip_returns(mg):
    by_mgr = defaultdict(list)
    for r in mg:
        by_mgr[r["manager_entry_id"]].append(r)
    deltas = {c: [] for c in CHIPS}
    for m, rows in by_mgr.items():
        base = [r["points"] for r in rows if not r["chip"] and r["points"] is not None]
        if not base:
            continue
        mu = statistics.mean(base)
        for r in rows:
            if r["chip"] in CHIPS and r["points"] is not None:
                deltas[r["chip"]].append(r["points"] - mu)
        # NB: in a BB week points_on_bench is 0 by definition (the bench counted),
        # so the realized BB value is the delta above, not points_on_bench.
    out = {}
    for c in CHIPS:
        d = deltas[c]
        if not d:
            out[c] = None; continue
        share_pos = statistics.mean(1 if x > 0 else 0 for x in d)
        out[c] = {"n": len(d), "mean_delta": round(statistics.mean(d), 1),
                  "median_delta": round(statistics.median(d), 1),
                  "share_positive": round(share_pos, 3),
                  "PAYS": statistics.mean(d) > CHIP_PAYS_MIN_DELTA and share_pos >= CHIP_PAYS_MIN_SHARE}
    return out


# ── (2) chip timing ──────────────────────────────────────────────────────────

def chip_timing(mg):
    gws = {c: [] for c in CHIPS}
    for r in mg:
        if r["chip"] in CHIPS:
            gws[r["chip"]].append(r["gw_number"])
    out = {}
    for c in CHIPS:
        g = gws[c]
        if not g:
            out[c] = None; continue
        cnt = Counter(g)
        # best <=5-GW window share
        best_share, best_win = 0.0, None
        for start in range(1, 39):
            w = sum(cnt[x] for x in range(start, start + TIMING_PRIOR_WINDOW))
            if w / len(g) > best_share:
                best_share, best_win = w / len(g), (start, start + TIMING_PRIOR_WINDOW - 1)
        out[c] = {"n": len(g), "half1": sum(1 for x in g if x <= HALF1_LAST),
                  "half2": sum(1 for x in g if x > HALF1_LAST),
                  "modal_gw": cnt.most_common(3),
                  "best_window": best_win, "best_window_share": round(best_share, 3),
                  "USABLE_PRIOR": best_share >= TIMING_PRIOR_SHARE}
    return out


# ── (3) SC vs NT behaviour ───────────────────────────────────────────────────

def sc_vs_nt(mg, picks, transfers, cls):
    groups = defaultdict(list)
    for m in {r["manager_entry_id"] for r in mg}:
        groups[cls[m]].append(m)
    # per-manager metrics
    base = defaultdict(dict)
    by_mgr = defaultdict(list)
    for r in mg:
        by_mgr[r["manager_entry_id"]].append(r)
    for m, rows in by_mgr.items():
        nonchip = [r["points"] for r in rows if not r["chip"] and r["points"] is not None]
        base[m]["final"] = max((r["total_points"] for r in rows if r["total_points"] is not None), default=None)
        base[m]["transfers"] = sum(r["event_transfers"] or 0 for r in rows)
        base[m]["hits"] = sum(1 for r in rows if (r["event_transfers_cost"] or 0) > 0)
        base[m]["hit_pts"] = sum(r["event_transfers_cost"] or 0 for r in rows)
    # chip timing means per group
    chip_gw = defaultdict(lambda: defaultdict(list))
    for r in mg:
        if r["chip"] in CHIPS:
            chip_gw[cls[r["manager_entry_id"]]][r["chip"]].append(r["gw_number"])

    def summ(group):
        ms = groups[group]
        if not ms:
            return None
        return {
            "n": len(ms),
            "mean_final": round(statistics.mean(base[m]["final"] for m in ms if base[m]["final"]), 0),
            "mean_transfers": round(statistics.mean(base[m]["transfers"] for m in ms), 1),
            "mean_hits_taken": round(statistics.mean(base[m]["hits"] for m in ms), 1),
            "mean_hit_pts_lost": round(statistics.mean(base[m]["hit_pts"] for m in ms), 1),
            "chip_median_gw": {c: (round(statistics.median(chip_gw[group][c]))
                               if chip_gw[group][c] else None) for c in CHIPS},
        }
    return {g: summ(g) for g in ("SC", "MID", "NT")}


# ── (4) captaincy herding + flip-flops ───────────────────────────────────────

def captaincy_herding(picks, cls):
    cap = defaultdict(dict)       # gw -> manager -> captain player
    for r in picks:
        if r["is_captain"]:
            cap[r["gw_number"]][r["manager_entry_id"]] = r["player_id"]
    shares, sc_agree, nt_agree = [], [], []
    for gw, mp in cap.items():
        if not mp:
            continue
        modal, n = Counter(mp.values()).most_common(1)[0]
        shares.append(n / len(mp))
        sc = [m for m in mp if cls[m] == "SC"]
        nt = [m for m in mp if cls[m] == "NT"]
        if sc:
            sc_agree.append(statistics.mean(1 if mp[m] == modal else 0 for m in sc))
        if nt:
            nt_agree.append(statistics.mean(1 if mp[m] == modal else 0 for m in nt))
    return {"mean_modal_captain_share": round(statistics.mean(shares), 3),
            "sc_agreement_with_modal": round(statistics.mean(sc_agree), 3) if sc_agree else None,
            "nt_agreement_with_modal": round(statistics.mean(nt_agree), 3) if nt_agree else None}


def flip_flops(transfers, mg, cls):
    """Reversals within FLIPFLOP_GW weeks, EXCLUDING wildcard/free-hit weeks
    (those are chip rebuilds of ~15 players, not flip-flops)."""
    chip_wk = {(r["manager_entry_id"], r["gw_number"]) for r in mg
               if r["chip"] in ("wildcard", "freehit")}
    by_mgr = defaultdict(list)
    for r in transfers:
        if (r["manager_entry_id"], r["gw_number"]) in chip_wk:
            continue
        by_mgr[r["manager_entry_id"]].append(r)
    per_group = defaultdict(list)
    for m in {r["manager_entry_id"] for r in mg}:
        ts = sorted(by_mgr.get(m, []), key=lambda r: (r["gw_number"], r["transfer_time"] or ""))
        outs, ins, ff = {}, {}, 0
        for r in ts:
            pin, pout, gw = r["player_in_id"], r["player_out_id"], r["gw_number"]
            if pin in outs and gw - outs[pin] <= FLIPFLOP_GW:   # re-bought a recent sale
                ff += 1
            if pout in ins and gw - ins[pout] <= FLIPFLOP_GW:   # sold a recent buy
                ff += 1
            ins[pin] = gw; outs[pout] = gw
        per_group[cls[m]].append(ff)
    return {g: round(statistics.mean(v), 2) for g, v in per_group.items() if v}
