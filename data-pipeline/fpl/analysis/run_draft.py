#!/usr/bin/env python3
"""Run the GW1 draft tool. Judgement aid, not an oracle.

    python -m analysis.run_draft --season 2026-27
    python -m analysis.run_draft --season 2026-27 --include "Salah,Haaland"
"""
from __future__ import annotations

import argparse
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import draft_tool as DT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2026-27")
    ap.add_argument("--include", default="", help="comma-separated web_names to force in")
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()
    names = [n for n in args.include.split(",") if n.strip()] or None

    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    r = DT.build(c, args.season, force_include_names=names)

    print("=" * 84)
    print(f"  GW1 DRAFT TOOL — {args.season}   (naive-optimal core · JUDGEMENT AID, not an oracle)")
    print("=" * 84)
    print(f"  {r['framing']}")
    print(f"\n  optimal 15 by last-season total | spend £{r['spend']:.1f}m | solver {r['status']}"
          + (f" | forced in: {', '.join(r['forced'])}" if r["forced"] else ""))
    print(f"  candidates {r['n_candidates']} (Tier A/B) | Tier-C no-prior watchlist: {r['n_tierC']}")
    print("  fixCtx = mean fixture-adjusted rel-ELO GW1-10 (context only, NOT in selection; +easier)")

    for x in r["squad"]:
        fl = ("  [" + ",".join(x["flags"]) + "]") if x["flags"] else ""
        print(f"\n  {x['pos']:<3} {x['name'][:17]:<17} £{x['price']:>4.1f}  {x['club']:<4} "
              f"lastTot={x['last_total']:>3}  sr={x['start_rate']:<5} ppgS={x['ppg_started']:<4} "
              f"fixCtx={x['fix_ctx']:>+5.0f}{fl}")
        for a in x["alternatives"]:
            af = ("  [" + ",".join(a["flags"]) + "]") if a["flags"] else ""
            print(f"        alt: {a['name'][:16]:<16} £{a['price']:>4.1f}  {a['club']:<4} "
                  f"lastTot={a['last_total']:>3}  fixCtx={a['fix_ctx']:>+5.0f}{af}")

    print("\n" + "-" * 84)
    print("  TEMPLATE LENS — emergent shape vs Study 7 recurring template (a lens, NOT a constraint)")
    print("-" * 84)
    L, R = r["template_lens"], r["template_ref"]
    print(f"  mean price/pos  chosen {L['mean_price']}   ref {R['mean_price']}")
    print(f"  cheap DEF (<£5) chosen {L['cheap_def_share_lt5']:.0%}   ref {R['cheap_def_share_lt5']:.0%}")
    print(f"  premium attackers (>=£10)  chosen {L['premium_attackers_ge10']}   ref {R['premium_attackers_ge10']}")
    print(f"  nailed share    chosen {L['nailed_share']:.0%}   ref {R['nailed_share']:.0%}")

    print("\n" + "-" * 84)
    print(f"  TIER-C WATCHLIST — no prior data, YOUR JUDGEMENT REQUIRED (top {min(20, len(r['tierC']))} by price)")
    print("  Usually 0-6% of the GW1-10 ceiling, but 19% in 2022/23 (Haaland's debut) — rarely")
    print("  load-bearing, occasionally decisive. Force any in with --include.")
    print("-" * 84)
    for t in r["tierC"][:20]:
        tag = " PROMOTED" if t.get("promoted_club") else ""
        print(f"  {t['pos']:<3} {t['name'][:20]:<20} £{t['price']:>4.1f}  {t['club_short']:<4}{tag}")

    print(f"\n  NOTE: pool is {r['n_candidates']}+{r['n_tierC']} pre-season and still filling; "
          "re-run run_newseason.py + this tool near the 21 Aug deadline before finalising.")

    if not args.no_write:
        fpl = load._fpl(c)
        fpl.table("insights").upsert({
            "slug": f"draft-gw1-{args.season}",
            "title": f"GW1 draft tool output — {args.season} (naive-optimal, judgement aid)",
            "summary": ("Backtest-honest GW1 draft aid: naive-optimal 15 (last-season total under "
                        "real constraints — the method that won the pre-registered backtest), with "
                        "per-player similar-price alternatives, Study 7 template as a lens (not a "
                        "constraint), fixture context (not in selection), and a prominent Tier-C "
                        "no-prior watchlist. A judgement aid, not an oracle. " + r["framing"]),
            "payload": r,
            "data_basis": (
                "Walk-forward: last-season total points, no lookahead. Projection layer REFUTED "
                "and excluded (draft-gw1-backtest). Fixture context and template are display-only "
                "(both lost points as selection inputs). Pool is a pre-season partial (~555->~700) "
                "— provisional until re-run near the 21 Aug deadline. Naive method won every "
                "backtest season but captures ~58% of the hindsight GW1-10 ceiling; the rest is "
                "newcomers (Tier-C, your judgement) + in-season adaptation."),
        }, on_conflict="slug").execute()
        print(f"\ninsights row 'draft-gw1-{args.season}' written.")


if __name__ == "__main__":
    main()
