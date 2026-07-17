#!/usr/bin/env python3
"""Study 2 — factor-correlation study. Assembles the walk-forward join once,
runs all 11 factors, writes one insights row per factor + a summary row, and
prints a per-factor readable table.

Usage: python -m analysis.run_study2
"""
from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import study2_factors as F
from analysis import params as P

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

DATA_BASIS = (
    "Six seasons 2020/21-2025/26. Unit: player-fixture. Factors measured on "
    "STARTERS (>=60 min) to isolate return-given-playing from the minutes gate "
    "(#10, measured on all rows). Stateful factors (ELO, form) use value ENTERING "
    "the GW (as-of t-1), walk-forward. CAVEATS: FDR scale differs by season "
    "(per-season only); ownership 2025/26-only + reverse-causation (contemporaneous "
    "vs predictive reported); price is lagging (transfer-driven); set-piece "
    "2025/26-only (~60 takers, thin by position); opponent/own strength are FPL "
    "static end-of-season facet ratings; 2020/21 behind-closed-doors (home/away "
    "factors reported with & without it). Effect = Spearman rho with Fisher-z 95% CI; "
    "cells N<100 flagged thin, N<30 not interpreted."
)


def _fmt_cell(c: dict) -> str:
    if not c or c.get("rho") is None:
        return f"   n/a (n={c.get('n', 0) if c else 0})"
    ci = c.get("ci95", [None, None])
    flag = " THIN" if c.get("thin") else ""
    ci_s = f"[{ci[0]:+.2f},{ci[1]:+.2f}]" if ci[0] is not None else "[--]"
    return f"rho={c['rho']:+.3f} {ci_s} n={c['n']}{flag}"


def _print_posmap(title, posmap):
    print(f"  {title}")
    for pos in ("GKP", "DEF", "MID", "FWD"):
        if pos in posmap:
            print(f"    {pos}: {_fmt_cell(posmap[pos])}")


def main() -> None:
    client = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    log.info("assembling walk-forward join across six seasons...")
    all_rows = []
    for s in P.RECORDED_SEASONS:
        rows = F._assemble(client, s)
        all_rows.extend(rows)
        log.info("  %s: %d player-fixture rows", s, len(rows))
    starters = sum(1 for r in all_rows if r["minutes"] >= F.STARTER_MIN)
    log.info("total %d rows (%d starters >=60min)", len(all_rows), starters)

    factors = {
        "01_fixture_difficulty": F.factor_01_fdr(all_rows),
        "02_home_away": F.factor_02_home_away(all_rows),
        "03_relative_elo": F.factor_03_relative_elo(all_rows),
        "04_opponent_facet": F.factor_04_opponent_facet(all_rows),
        "05_team_form_beyond_baseline": F.factor_05_team_form_beyond_baseline(all_rows),
        "06_player_form": F.factor_06_player_form(all_rows),
        "07_price": F.factor_07_price(all_rows),
        "08_ownership": F.factor_08_ownership(all_rows),
        "09_positional_team_strength": F.factor_09_positional_team_strength(all_rows),
        "10_minutes": F.factor_10_minutes(all_rows),
        "11_set_piece": F.factor_11_set_piece(client, all_rows),
    }

    fpl = load._fpl(client)
    print("\n" + "=" * 66)
    print("  STUDY 2 — FACTOR-CORRELATION (per position, starters unless noted)")
    print("=" * 66)

    for key, result in factors.items():
        print(f"\n[{key}]  {result['note']}")
        # print the primary posmap(s)
        for sub, val in result.items():
            if sub == "note":
                continue
            if isinstance(val, dict) and val and all(
                    isinstance(v, dict) and ("rho" in v or "delta" in v or "mean_a" in v)
                    for v in val.values() if isinstance(v, dict)):
                # a position map
                if all(k in ("GKP", "DEF", "MID", "FWD") for k in val):
                    _print_posmap(sub + ":", {k: v for k, v in val.items() if "rho" in v})
                    # mean_diff maps (home/away, set-piece)
                    for pos, cell in val.items():
                        if isinstance(cell, dict) and "delta" in cell:
                            print(f"    {pos}: delta={cell['delta']}  "
                                  f"(a={cell['mean_a']} b={cell['mean_b']} "
                                  f"d={cell['cohens_d']} nA={cell['n_a']} nB={cell['n_b']})")
                else:
                    print(f"  {sub}:")
                    for k2, v2 in val.items():
                        if isinstance(v2, dict) and "rho" in v2:
                            print(f"    {k2}: {_fmt_cell(v2)}")

        # write insights row (full nested payload)
        fpl.table("insights").upsert({
            "slug": f"study2-factor-{key.replace('_', '-')}",
            "title": f"Study 2 factor {key.replace('_', ' ')}",
            "summary": result["note"],
            "payload": {k: v for k, v in result.items() if k != "note"},
            "data_basis": DATA_BASIS,
        }, on_conflict="slug").execute()

    print("\n" + "=" * 66)
    print(f"  {len(factors)} factor insights rows written. Assembled {len(all_rows):,} rows.")
    print("=" * 66)


if __name__ == "__main__":
    main()
