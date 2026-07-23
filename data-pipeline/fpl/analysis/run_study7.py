#!/usr/bin/env python3
"""Study 7 — set-and-forget optimal squad. Ceiling, manager gap, archetype pattern."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import study7_optimal as S7
from analysis import params as P


def main():
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print("=" * 78)
    print("  STUDY 7 — RETROSPECTIVE SET-AND-FORGET OPTIMAL SQUAD (hindsight ceiling)")
    print("=" * 78)

    all_squads, ceilings = {}, {}
    for s in P.RECORDED_SEASONS:
        sol, squad = S7.solve_season(c, s)
        all_squads[s], ceilings[s] = squad, sol
        bench = S7.manager_benchmark(c, s)
        print(f"\n── {s} ──  ceiling {sol.total_points:.0f} pts  "
              f"(spend £{sol.spend:.1f}m, solver {sol.status})")
        for r in squad:
            tag = "".join(x for x in [
                (r["archetype"] or "?")[:4],
                " PROMO" if r["promoted"] else ""] )
            print(f"    {r['pos']:<3} {r['name'][:18]:<18} £{r['price']:>4.1f}  "
                  f"{r['season_pts']:>4.0f}pts  [{tag}]")
        if bench:
            gap_me = (sol.total_points - bench['me']) if bench['me'] else None
            print(f"    vs REAL managers ({bench['n_elite']} elite): "
                  f"best {bench['elite_best']}  median {bench['elite_median']}  "
                  f"me {bench['me']}"
                  + (f"  (ceiling is +{gap_me:.0f} over me, "
                     f"+{sol.total_points-bench['elite_best']:.0f} over the best elite)"
                     if gap_me is not None else ""))
        else:
            print("    vs REAL managers: no cohort/personal data this season")

    # K-stability check on the most recent season (does a larger XI pool change it?)
    latest = P.RECORDED_SEASONS[-1]
    sol_big, _ = S7.solve_season(c, latest, start_k=80)
    print(f"\n[K-stability] {latest}: ceiling at K=45 {ceilings[latest].total_points:.0f} "
          f"vs K=80 {sol_big.total_points:.0f} "
          f"({'STABLE' if abs(ceilings[latest].total_points - sol_big.total_points) < 0.5 else 'CHANGED'})")

    pat = S7.cross_season_pattern(all_squads)
    print("\n" + "=" * 78)
    print("  CROSS-SEASON ARCHETYPE PATTERN (the GW1-drafting signal)")
    print("=" * 78)
    print(f"  archetype distribution (of 15x6 slots): {pat['archetype_distribution']}")
    print(f"  mean price by position: {pat['mean_price_by_position']}")
    print(f"  cheap (<£5.0) share of optimal DEFs: {pat['cheap_def_share']:.0%}")
    print(f"  newly-promoted-club share of slots: "
          f"{pat['promoted_share']:.0%} ({pat['promoted_count']}/{pat['promoted_known_seasons_slots']})"
          if pat['promoted_share'] is not None else "  promoted share: n/a")
    print("  price-band by position:")
    for p in ("GKP", "DEF", "MID", "FWD"):
        print(f"    {p}: {pat['price_band_by_position'].get(p, {})}")

    result = {
        "ceilings": {s: ceilings[s].total_points for s in ceilings},
        "squads": {s: [{k: r[k] for k in ("name", "pos", "price", "archetype",
                        "promoted", "season_pts")} for r in sq]
                   for s, sq in all_squads.items()},
        "pattern": pat,
        "manager_gap_2025_26": S7.manager_benchmark(c, latest),
        "start_k": S7.START_K,
        "k_stability": {"k45": ceilings[latest].total_points, "k80": sol_big.total_points},
    }
    fpl = load._fpl(c)
    fpl.table("insights").upsert({
        "slug": "study7-set-and-forget-ceiling",
        "title": "Study 7 — set-and-forget optimal squad (hindsight ceiling + archetype pattern)",
        "summary": ("Retrospective best legal 15 at GW1 prices, unchanged all season, optimal "
                    "XI+captain each GW (ILP, PuLP/CBC). Reports the ceiling, the gap to real "
                    "managers (2025/26 only — sole season with cohort+personal data), and the "
                    "CROSS-SEASON ARCHETYPE PATTERN (what KINDS of players recur — the legitimate "
                    "GW1 draft signal). HINDSIGHT CEILING, not an achievable target: nobody picks "
                    "it ex ante; value is as a benchmark and an archetype signal only."),
        "payload": result,
        "data_basis": (
            "Six seasons 2020/21-2025/26. Squad ILP: budget 100.0, 2/5/5/3, max 3 per club, "
            "valid XI formation, captain doubled. GW1 price and GW1 club taken from each player's "
            "GW1 fixture row (avoids the end-of-season team_id caveat). Candidates = players "
            "present at GW1 only (mid-season signings excluded — un-buyable at GW1). XI/captain "
            f"vars restricted to top-{S7.START_K}/position by season points (bench-filler "
            "reduction; K-stability verified vs K=80). Archetypes from player_archetypes; "
            "promotion via teams.code vs prior season (n/a for 2020/21, the earliest). Manager "
            "gap from manager_gameweeks/my_entry_gameweeks final total_points."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'study7-set-and-forget-ceiling' written.")


if __name__ == "__main__":
    main()
