#!/usr/bin/env python3
"""Study 6 Phase B — ownership/mispricing on the ppg base. Pre-registered."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import study6b_ownership as B


def main():
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print("=" * 78)
    print("  STUDY 6 PHASE B — PRE-REGISTERED CRITERIA (fixed before measuring)")
    print("=" * 78)
    print(f"  Horizon: subsequent points t+1..t+{B.HORIZON}. Ownership = within-GW")
    print(f"  percentile among the decision set (raw counts archive + DB % 2025/26).")
    print(f"  (a) PREDICTIVE PASS  : partial rho(own,subsequent|ppg) <= -{B.PRED_MIN_ABS}")
    print(f"                         AND negative in >= {B.CONSISTENCY}/{B.N_SEASONS} seasons")
    print(f"                         (undervaluation needs NEGATIVE; +{B.PRED_MIN_ABS} = owned-do-better)")
    print(f"  (b) MISPRICING PASS  : a category with mean(ret_pct-own_pct) >= {B.MISPRICE_DIFF}")
    print(f"                         in >= {B.CONSISTENCY}/{B.N_SEASONS} seasons (n>={B.MISPRICE_MIN_N}/season)")
    print(f"      PORTFOLIO confirm: high-ppg+low-own subsequent mean >= high-ppg pool")
    print(f"                         mean in >= {B.CONSISTENCY}/{B.N_SEASONS} seasons")
    print(f"  GUARD  PASS          : top-{B.GUARD_TOPN} undervaluation picks/season have")
    print(f"                         rotation+fringe share <= {B.GUARD_MAX_RISK:.0%} in >= {B.CONSISTENCY}/{B.N_SEASONS} seasons")

    rows = B.build_rows(c)
    print(f"\n  assembled decision rows (all seasons): {len(rows)}")

    a = B.test_a_predictive(rows)
    print("\n" + "-" * 78)
    print("  (a) PREDICTIVE — partial Spearman(ownership, subsequent | ppg)")
    print("-" * 78)
    print(f"  pooled ALL: {a['pooled']['ALL']:+.4f}   by position: " +
          "  ".join(f"{p} {a['pooled'][p]:+.3f}" for p in ('GKP','DEF','MID','FWD')))
    print(f"  per season: " + "  ".join(f"{s.split('-')[0]}:{a['per_season'][s]:+.3f}"
          for s in a['per_season'] if a['per_season'][s] is not None))
    print(f"  negative in {a['neg_seasons']}/6 seasons")
    print(f"  VERDICT: {a['verdict']}")

    b = B.test_b_mispricing(rows)
    print("\n" + "-" * 78)
    print(f"  (b) MISPRICING — category mean(return_pct - ownership_pct); +ve = under-owned")
    print("-" * 78)
    any_pass = False
    for cat, d in b.items():
        print(f"  [{cat}]")
        for cv, m in sorted(d.items(), key=lambda kv: -kv[1]["pooled_diff"]):
            flag = "  <== PASS" if m["PASS"] else ""
            any_pass = any_pass or m["PASS"]
            print(f"    {cv:<10} pooled {m['pooled_diff']:+.3f}  "
                  f"({m['seasons_over_thresh']}/6 seasons >= {B.MISPRICE_DIFF}, n={m['n_pooled']}){flag}")

    port = B.portfolio(rows)
    print("\n" + "-" * 78)
    print("  PORTFOLIO — subsequent points: high-ppg pool vs high-ppg+low-ownership")
    print("-" * 78)
    print(f"  {'season':<9}{'n_pool':>8}{'pool':>8}{'low-own':>9}{'high-own':>10}{'hit@50':>9}")
    for s in [k for k in port if k.endswith(tuple('12345678')) or '-' in str(k)]:
        m = port[s]
        if m is None:
            continue
        print(f"  {s:<9}{m['n_pool']:>8}{m['pool_mean']:>8.2f}{m['lowown_mean']:>9.2f}"
              f"{m['highown_mean']:>10.2f}{m['hit_rate_vs50']:>9.3f}")
    print(f"  low-own >= pool mean in {port['lowown_ge_pool_seasons']}/6 seasons; "
          f"low-own >= high-own in {port['lowown_ge_highown_seasons']}/6")

    g = B.guard(rows)
    print("\n" + "-" * 78)
    print(f"  FALSE-POSITIVE GUARD — top-{B.GUARD_TOPN} undervaluation picks/season by archetype")
    print("-" * 78)
    print(f"  {'season':<9}{'nailed':>8}{'rotation':>10}{'fringe':>8}{'risk_share':>12}")
    for s in [k for k in g if '-' in str(k)]:
        m = g[s]
        print(f"  {s:<9}{m['nailed']:>8}{m['rotation']:>10}{m['fringe']:>8}{m['risk_share']:>12.2f}")
    print(f"  rotation+fringe <= {B.GUARD_MAX_RISK:.0%} in {g['clean_seasons']}/6 seasons")

    print("\n" + "=" * 78)
    print("  PRE-REGISTERED VERDICTS")
    print("=" * 78)
    a_pass = a['pooled']['ALL'] is not None and a['pooled']['ALL'] <= -B.PRED_MIN_ABS and a['neg_seasons'] >= B.CONSISTENCY
    print(f"  (a) PREDICTIVE : {'PASS' if a_pass else 'FAIL'}  ({a['verdict']})")
    print(f"  (b) MISPRICING : category test {'PASS' if any_pass else 'FAIL'}; "
          f"portfolio {'PASS' if port['PASS_outperform'] else 'FAIL'}")
    print(f"  GUARD          : {'PASS' if g['PASS'] else 'FAIL'} "
          f"({g['clean_seasons']}/6 seasons clean)")

    result = {"criteria": {"PRED_MIN_ABS": B.PRED_MIN_ABS, "MISPRICE_DIFF": B.MISPRICE_DIFF,
                           "consistency": B.CONSISTENCY, "horizon": B.HORIZON,
                           "guard_max_risk": B.GUARD_MAX_RISK},
              "predictive": a, "mispricing": b, "portfolio": port, "guard": g,
              "verdicts": {"predictive_pass": a_pass, "mispricing_category_pass": any_pass,
                           "portfolio_pass": port["PASS_outperform"], "guard_pass": g["PASS"]}}
    fpl = load._fpl(c)
    fpl.table("insights").upsert({
        "slug": "study6-phaseB-ownership",
        "title": "Study 6 Phase B — ownership / mispricing term on the ppg base (pre-registered)",
        "summary": ("Pre-registered test of whether an ownership term adds edge on top of the "
                    "ppg hold-value estimate. (a) predictive: partial rho(own,subsequent|ppg). "
                    "(b) mispricing: identifiable under-owned player TYPES + decision portfolio "
                    "(high-ppg+low-own vs high-ppg). Plus the Study-5 nailed-ness false-positive "
                    "guard. Criteria fixed in code before measuring; see verdicts."),
        "payload": result,
        "data_basis": (
            f"Six seasons 2020/21-2025/26. Subsequent = cumulative points t+1..t+{B.HORIZON}, "
            "walk-forward decision points (ppg from >=3 prior GWs, from GW6). Ownership: raw "
            "vaastav `selected` counts (archive) + DB selected_by (2025/26), converted to "
            "WITHIN-GW percentile among the decision set before pooling (monotonic rank -> "
            "count/% and manager-base-growth neutralised). Archetype from player_archetypes. "
            "Single-GW noise ceiling still applies; percentiles reduce but do not remove it."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'study6-phaseB-ownership' written.")


if __name__ == "__main__":
    main()
