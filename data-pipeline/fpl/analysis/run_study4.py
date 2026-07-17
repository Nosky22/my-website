#!/usr/bin/env python3
"""Study 4 — player archetypes. Analysis + insights summary.

The fpl.player_archetypes TABLE is proposed for approval (not created here);
until then this writes the classification summary + persistence result to
insights and can populate the table once approved.

Usage: python -m analysis.run_study4          # analysis + insights summary
       python -m analysis.run_study4 --populate  # ALSO write player_archetypes
                                                  # (only after the table exists)
"""
from __future__ import annotations

import argparse
import os
from collections import Counter

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load, query
from analysis import study4_archetypes as A
from analysis import params as P

DATA_BASIS = (
    "Six seasons 2020/21-2025/26, player-seasons with >=10 appearances (2,476). "
    "Archetype axis = STABILITY (start_rate = starts / season GWs), NOT quality "
    "(ppg reported separately). nailed >=0.75, rotation 0.35-0.75, fringe <0.35 "
    "(tunable). Cross-season linkage by canonical_id. Walk-forward: a season's "
    "class is usable at GW1 of the NEXT season. CAVEATS: start_rate penalises "
    "mid-season transfers/injuries (arguably correct for FPL planning); per-player "
    "fixture-sensitivity over ~30 games is noisy."
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--populate", action="store_true", help="write fpl.player_archetypes (needs table)")
    args = ap.parse_args()
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    all_rows = []
    for s in P.RECORDED_SEASONS:
        all_rows += A.player_seasons(c, s)

    dist = dict(Counter(r["archetype"] for r in all_rows))
    persist = A.cross_season_persistence(all_rows)
    third = A.third_archetype_evidence(all_rows)

    print("=" * 64)
    print("  STUDY 4 — PLAYER ARCHETYPES")
    print("=" * 64)
    print(f"\nclassified player-seasons: {len(all_rows)}   distribution: {dist}")
    print(f"\nCROSS-SEASON PERSISTENCE (the key question):")
    print(f"  start_rate Spearman S->S+1: {persist['start_rate_spearman_S_to_S+1']} "
          f"(n={persist['n_pairs']} pairs)")
    base = {k: round(v / len(all_rows), 3) for k, v in dist.items()}
    for a, d in persist["archetype_persistence"].items():
        print(f"  {a:<9} stay={d['stay']} (base rate {base.get(a)}) -> {dict(d['to'])}")
    print(f"\n3rd-archetype evidence: {third['share_high_sens(>0.25)']:.0%} of nailed players "
          f"have fixture-sensitivity >0.25 (p50={third['fixture_sensitivity_pctiles']['p50']})")

    fpl = load._fpl(c)
    fpl.table("insights").upsert({
        "slug": "study4-player-archetypes",
        "title": "Study 4 — player archetypes (stability, not quality)",
        "summary": ("Classify player-seasons by minutes STABILITY (nailed/rotation/"
                    "fringe), quality separate. Cross-season persistence moderate "
                    "(start_rate rho 0.51 S->S+1; nailed stays nailed 51% vs 20% base "
                    "= 2.5x chance, but ~half drift): a USABLE prior for GW1 drafting, "
                    "not a deterministic label - must be updated with pre-season news."),
        "payload": {"distribution": dist, "base_rates": base,
                    "persistence": persist, "third_archetype_evidence": third,
                    "thresholds": {"nailed": A.NAILED_MIN, "rotation": A.ROTATION_MIN}},
        "data_basis": DATA_BASIS,
    }, on_conflict="slug").execute()
    print("\ninsights row 'study4-player-archetypes' written.")

    if args.populate:
        rows = [{"season_id": r["season"], "player_id": r["player_id"],
                 "archetype": r["archetype"], "start_rate": r["start_rate"],
                 "ppg_started": r["ppg_started"], "minutes_cv": r["minutes_cv"],
                 "fixture_sensitivity": r["fixture_sensitivity"],
                 "appearances": r["appearances"]} for r in all_rows]
        n = load.upsert_player_archetypes(c, rows)   # requires the table + load fn
        print(f"player_archetypes populated: {n} rows")


if __name__ == "__main__":
    main()
