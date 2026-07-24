#!/usr/bin/env python3
"""Run the pre-registered three-way GW1 draft backtest and report."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import draft_backtest as BT


def main():
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print("=" * 82)
    print("  GW1 DRAFT — PRE-REGISTERED THREE-WAY BACKTEST (walk-forward, actual GW1-10 pts)")
    print("=" * 82)
    print(f"  PROJECTION passes iff it beats NAIVE in >= {BT.MIN_SEASONS}/5 seasons AND pooled > 0.")
    print("  3/5 is coin-flip by chance -> we report the pooled MARGIN and spread, not just the count.")
    print("  Third arm TEMPLATE-only isolates whether the Study 7 shape alone already beats naive.\n")

    res = BT.run(c)
    print(f"  {'season':<9}{'naive':>8}{'template':>10}{'projection':>12}{'ceiling':>9}"
          f"{'proj-naive':>12}{'tmpl-naive':>12}{'TierC%ceil':>11}")
    for s, v in res.items():
        sc = v["scores"]
        print(f"  {s:<9}{sc['naive']:>8.0f}{sc['template']:>10.0f}{sc['projection']:>12.0f}"
              f"{v['ceiling']:>9.0f}{v['proj_minus_naive']:>+12.1f}{v['tmpl_minus_naive']:>+12.1f}"
              f"{v['tierC_share_of_ceiling']:>11.0%}")

    s = BT.summarise(res)
    print("\n" + "-" * 82)
    print("  PRE-REGISTERED VERDICT")
    print("-" * 82)
    print(f"  projection beats naive: {s['proj_beats_naive_seasons']} seasons  |  "
          f"pooled {s['proj_minus_naive_pooled']:+.1f} pts  "
          f"(mean {s['proj_minus_naive_mean']:+.1f} ± {s['proj_minus_naive_sd']:.1f} sd/season)")
    print(f"  template beats naive  : {s['tmpl_beats_naive_seasons']} seasons  |  "
          f"pooled {s['tmpl_minus_naive_pooled']:+.1f} pts  "
          f"(mean {s['tmpl_minus_naive_mean']:+.1f} ± {s['tmpl_minus_naive_sd']:.1f} sd/season)")
    print(f"\n  PROJECTION PASSES pre-registered bar: {s['PROJECTION_PASSES']}")
    print(f"  TEMPLATE-alone already beats naive:   {s['template_alone_beats_naive']}")
    tc = [v['tierC_share_of_ceiling'] for v in res.values()]
    print(f"\n  Tier-C (no-prior) share of the retrospective GW1-10 ceiling: "
          f"{min(tc):.0%}-{max(tc):.0%} across seasons (recent seasons most relevant to 2026/27).")

    fpl = load._fpl(c)
    fpl.table("insights").upsert({
        "slug": "draft-gw1-backtest",
        "title": "GW1 draft — pre-registered three-way backtest (projection vs template vs naive)",
        "summary": ("Walk-forward validation of the GW1 draft method before building the tool. "
                    "Three selection arms scored on actual GW1-10 points: NAIVE (last-season "
                    "total), TEMPLATE-only (Study 7 structural shape), PROJECTION (discounted "
                    "GW1-10 ILP). Pre-registered: projection passes iff it beats naive in >=3/5 "
                    "seasons AND pooled. Also quantifies the Tier-C (no-prior) share of the "
                    "retrospective ceiling — how much of achievable GW1-10 points comes from "
                    "un-projectable newcomers (the manual-include override's importance)."),
        "payload": {"per_season": res, "summary": s, "template_constraints": BT.TMPL,
                    "gamma": __import__("analysis.draft_projection", fromlist=["GAMMA"]).GAMMA},
        "data_basis": (
            "Target seasons 2021/22-2025/26, each projected from prior seasons only (no "
            "lookahead). Priors: start_rate + ppg_started (archetype Tier A; crude Tier B), "
            "fixture-adjusted ELO prior (regressed prior finals; promoted 1350), gamma=0.92 "
            "discount modelling plan-revision + uncertainty (NOT decay). Scoring identical "
            "across arms: optimal XI + captain on real GW1-10 points via the Study 7 ILP core. "
            "Single trial per season (5 total) — pooled margin and spread reported, 3/5 is "
            "coin-flip. Recent seasons (more prior data) are the closest analog to 2026/27."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'draft-gw1-backtest' written.")


if __name__ == "__main__":
    main()
