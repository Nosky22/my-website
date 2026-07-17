#!/usr/bin/env python3
"""Study 3 — noise ceiling + per-factor decay. Ceiling first, then curves.

Usage: python -m analysis.run_study3
"""
from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import study3_decay as D
from analysis import study2_factors as F  # for reading Study-2 ELO rho back
from analysis import params as P

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

# Study 2 relative-ELO rho (starters, all seasons) — for fraction-of-ceiling
STUDY2_ELO_RHO = {"GKP": 0.157, "DEF": 0.284, "MID": 0.223, "FWD": 0.159}


def _curve_line(curve, label):
    cells = " ".join(
        f"n{n}:{curve[n]['rho']:+.2f}" if curve[n]["rho"] is not None else f"n{n}:--"
        for n in D.HORIZONS)
    return f"    {label:<5} {cells}"


def main():
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    log.info("building six-season timelines...")
    timelines = []
    for s in P.RECORDED_SEASONS:
        tl, mg = D.build_timeline(c, s)
        timelines.append(tl)
        log.info("  %s: %d players", s, len(tl))

    fpl = load._fpl(c)
    print("\n" + "=" * 70)
    print("  STUDY 3 — NOISE CEILING + PER-FACTOR DECAY")
    print("=" * 70)

    # ── 1. Ceiling ──
    ceil = D.noise_ceiling(timelines)
    print("\n[1] NOISE CEILING (single-GW starter points)")
    print(f"  {'pos':<5}{'ICC':>7}{'ceiling_rho':>13}{'split-half':>12}{'players':>9}")
    for pos in D.POSITIONS:
        cc = ceil[pos]
        print(f"  {pos:<5}{cc['icc'] if cc['icc'] is not None else 'n/a':>7}"
              f"{cc['ceiling_rho'] if cc['ceiling_rho'] is not None else 'n/a':>13}"
              f"{cc.get('split_half_oddeven_rho', 'n/a'):>12}{cc.get('n_players', 0):>9}")
    print("\n  Study-2 relative-ELO rho AS A FRACTION OF CEILING:")
    for pos in D.POSITIONS:
        cr = ceil[pos]["ceiling_rho"]
        if cr:
            frac = STUDY2_ELO_RHO[pos] / cr
            print(f"    {pos}: rho {STUDY2_ELO_RHO[pos]:+.3f} / ceiling {cr:.3f} = {frac:.0%} of ceiling")

    # ── 2. Decay curves (cumulative primary) ──
    print("\n[2] DECAY CURVES — Spearman(factor at t, CUMULATIVE points t+1..t+n)")
    elo = D.decay_curve(timelines, "elo_t", cumulative=True)
    print("\n  ELO (team strength) — the fixture-cluster representative "
          "(#1 FDR / #2 home-away / #4 facet / #9 positional are VIEWS of this):")
    for pos in D.POSITIONS:
        print(_curve_line(elo[pos], pos))
    form = D.decay_curve(timelines, "form4_t", cumulative=True)
    print("\n  Player form (last-4 ppg) — raw:")
    for pos in D.POSITIONS:
        print(_curve_line(form[pos], pos))
    own = D.decay_curve(timelines, "selected_by", cumulative=True)
    print("\n  Ownership (2025/26 only) — a VIEW/denominator, weak proxy for quality:")
    for pos in D.POSITIONS:
        print(_curve_line(own[pos], pos))
    price = D.decay_curve(timelines, "value", cumulative=True)
    print("\n  Price (lagging) — cumulative:")
    for pos in D.POSITIONS:
        print(_curve_line(price[pos], pos))

    # ── 3. Player-form control ──
    print("\n[3] PLAYER FORM CONTROL — does last-4 form predict BEYOND own baseline")
    print("    (season-to-date excluding last 4, walk-forward)? raw vs partial:")
    ctrl = D.player_form_controlled(timelines)
    for pos in D.POSITIONS:
        row = ctrl[pos]
        raw = " ".join(f"n{n}:{row[n]['raw']:+.2f}" if row[n].get("raw") is not None else f"n{n}:--" for n in D.HORIZONS)
        par = " ".join(f"n{n}:{row[n]['partial_controlling_baseline']:+.2f}"
                       if row[n].get("partial_controlling_baseline") is not None else f"n{n}:--" for n in D.HORIZONS)
        print(f"    {pos} raw     {raw}")
        print(f"    {pos} partial {par}")

    # ── 4. Minutes persistence ──
    print("\n[4] MINUTES PERSISTENCE — P(starter at t still starting at t+n)")
    mins = D.minutes_persistence(timelines)
    for pos in D.POSITIONS:
        line = " ".join(f"n{n}:{mins[pos][n]['p_still_starting']:.2f}"
                        if mins[pos][n].get("p_still_starting") is not None else f"n{n}:--" for n in D.HORIZONS)
        print(f"    {pos}  {line}")

    # ── write insights ──
    DATA_BASIS = (
        "Six seasons 2020/21-2025/26, starters (>=60min) at t. Decay vs CUMULATIVE "
        "points over t+1..t+n (planning-relevant), single-GW noisy. Walk-forward. "
        "Ceiling = sqrt(ICC) of single-GW starter points (a lower bound; fixture "
        "context adds exploitable variance). Fixture cluster (#1/#2/#4/#9) collapsed "
        "to ONE ELO curve. Team form (#5) skipped (null at h1). Ownership 2025/26-only."
    )
    payloads = {
        "study3-noise-ceiling": {"ceiling": ceil, "study2_elo_rho": STUDY2_ELO_RHO},
        "study3-decay-elo": {"curve": {p: elo[p] for p in D.POSITIONS}},
        "study3-decay-player-form": {"raw": {p: form[p] for p in D.POSITIONS},
                                     "controlled": ctrl},
        "study3-decay-ownership-price": {"ownership": {p: own[p] for p in D.POSITIONS},
                                         "price": {p: price[p] for p in D.POSITIONS}},
        "study3-minutes-persistence": {"curve": mins},
    }
    for slug, payload in payloads.items():
        fpl.table("insights").upsert({
            "slug": slug, "title": slug.replace("-", " "),
            "summary": "Study 3 — " + slug.split("study3-")[1].replace("-", " "),
            "payload": payload, "data_basis": DATA_BASIS,
        }, on_conflict="slug").execute()

    print("\n" + "=" * 70)
    print(f"  {len(payloads)} Study-3 insights rows written.")
    print("=" * 70)


if __name__ == "__main__":
    main()
