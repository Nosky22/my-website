#!/usr/bin/env python3
"""Study 8 — elite-manager behaviour (chip/calendar). DESCRIPTIVE, pre-registered."""
from __future__ import annotations

import os
from collections import Counter
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load as L
from analysis import study8_behaviour as B


def main():
    c = L.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    mg, picks, transfers, cls = B.load(c)
    dist = Counter(cls[m] for m in {r["manager_entry_id"] for r in mg})

    print("=" * 78)
    print("  STUDY 8 — ELITE-MANAGER BEHAVIOUR (2025/26, DESCRIPTIVE — NOT CAUSAL)")
    print("=" * 78)
    print(f"  Cohort: top-150 in 2025/26. Classification by PRIOR top-10k finishes:")
    print(f"    SC (>=2 prior top-10k) n={dist['SC']}   MID (1) n={dist['MID']}   NT (0) n={dist['NT']}")
    print("  SURVIVORSHIP: 123/150 have NO prior track record — shared behaviour may be luck.")
    print("  No output is a causal claim. n=10 SC => SC differences are hypothesis-generating only.")
    print("\n  PRE-REGISTERED CRITERIA (fixed before measuring):")
    print(f"    (1) a chip PAYS iff within-manager mean delta > 0 AND >= {B.CHIP_PAYS_MIN_SHARE:.0%} of uses beat own baseline")
    print(f"    (2) timing is a USABLE PRIOR iff >= {B.TIMING_PRIOR_SHARE:.0%} of uses fall in a <= {B.TIMING_PRIOR_WINDOW}-GW window")
    print(f"    (3) SC vs NT: report effect sizes; call NOTHING significant (n=10). Flag only large gaps in the mechanical metric.")

    print("\n" + "-" * 78)
    print("  (1) CHIP RETURNS — within-manager (chip-week points minus own non-chip mean)")
    print("-" * 78)
    cr = B.chip_returns(mg)
    print(f"  {'chip':<10}{'n':>5}{'mean Δ':>9}{'median Δ':>10}{'% positive':>12}   verdict")
    for ch in B.CHIPS:
        r = cr[ch]
        if r:
            print(f"  {ch:<10}{r['n']:>5}{r['mean_delta']:>+9.1f}{r['median_delta']:>+10.1f}"
                  f"{r['share_positive']:>12.0%}   {'PAYS' if r['PAYS'] else 'does NOT clear bar'}")
    print("  (NB: BB week points_on_bench is 0 by definition — the bench counted; the delta IS the BB value)")

    print("\n" + "-" * 78)
    print("  (2) CHIP TIMING — two halves (GW1-19 / GW20-38)")
    print("-" * 78)
    ct = B.chip_timing(mg)
    for ch in B.CHIPS:
        r = ct[ch]
        if r:
            print(f"  {ch:<10} n={r['n']:<4} half1={r['half1']:<4} half2={r['half2']:<4} "
                  f"modal GWs={[g for g,_ in r['modal_gw']]}  best {r['best_window']}={r['best_window_share']:.0%}"
                  f"  {'<-- usable prior' if r['USABLE_PRIOR'] else ''}")

    print("\n" + "-" * 78)
    print("  (3) SKILL-CONSISTENT (SC, n=10) vs NO-TRACK (NT) — behaviour, not outcome")
    print("-" * 78)
    sv = B.sc_vs_nt(mg, picks, transfers, cls)
    hdr = ("final", "transfers", "hits", "hit_pts", "WC", "FH", "BB", "TC")
    print(f"  {'grp':<5}{'n':>4}{'mean_final':>11}{'transfers':>10}{'hits':>6}{'hitPts':>8}"
          f"{'  WC/FH/BB/TC median GW':>26}")
    for g in ("SC", "MID", "NT"):
        s = sv[g]
        if not s:
            continue
        cm = s["chip_median_gw"]
        print(f"  {g:<5}{s['n']:>4}{s['mean_final']:>11.0f}{s['mean_transfers']:>10.1f}"
              f"{s['mean_hits_taken']:>6.1f}{s['mean_hit_pts_lost']:>8.1f}"
              f"   {cm['wildcard']}/{cm['freehit']}/{cm['bboost']}/{cm['3xc']}")

    print("\n" + "-" * 78)
    print("  (4) CAPTAINCY HERDING + FLIP-FLOPS (lower priority)")
    print("-" * 78)
    ch_h = B.captaincy_herding(picks, cls)
    print(f"  mean modal-captain share across cohort: {ch_h['mean_modal_captain_share']:.0%}"
          f"   SC agreement {ch_h['sc_agreement_with_modal']:.0%} vs NT {ch_h['nt_agreement_with_modal']:.0%}")
    ff = B.flip_flops(transfers, mg, cls)
    print(f"  mean flip-flops (reversal within {B.FLIPFLOP_GW} GWs) per manager: {ff}")

    result = {"classification": dict(dist), "chip_returns": cr, "chip_timing": ct,
              "sc_vs_nt": sv, "captaincy_herding": ch_h, "flip_flops": ff,
              "criteria": {"chip_pays_min_share": B.CHIP_PAYS_MIN_SHARE,
                           "timing_window": B.TIMING_PRIOR_WINDOW, "timing_share": B.TIMING_PRIOR_SHARE}}
    fpl = L._fpl(c)
    fpl.table("insights").upsert({
        "slug": "study8-elite-behaviour",
        "title": "Study 8 — elite-manager behaviour (chip/calendar, descriptive)",
        "summary": ("DESCRIPTIVE, NOT CAUSAL. 150 top-150 managers, one season (2025/26). "
                    "(1) within-manager chip returns; (2) chip timing over the two halves; "
                    "(3) skill-consistent (>=2 prior top-10k, n=10) vs no-track (n=123) behaviour; "
                    "(4) captaincy herding + flip-flops. Pre-registered; expect nulls. "
                    "SURVIVORSHIP: 123/150 have no prior track record, so shared cohort behaviour "
                    "may be luck; SC-only behaviour is the better (still non-causal) evidence."),
        "payload": result,
        "data_basis": (
            "manager_gameweeks/picks/transfers/seasons for 2025/26, 150 managers (top-150 overall "
            "that season). Chip return = chip-week points minus that manager's own non-chip mean "
            "(within-manager, controls quality; still confounded by DGW timing + luck). Two-halves "
            "chip system: each chip usable once per half (GW1-19 expiring, GW20-38). Prior top-10k "
            "from manager_seasons career history. Cannot establish causation with n=150, one season, "
            "123 no-track; every figure is descriptive."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'study8-elite-behaviour' written.")


if __name__ == "__main__":
    main()
