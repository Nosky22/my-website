#!/usr/bin/env python3
"""Run the pre-registered chip-timing premise test and report."""
from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import chip_premise as CP


def main():
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    print("=" * 92)
    print("  CHIP-TIMING PREMISE TEST — 150 elite managers, real 2025/26 squads (DESCRIPTIVE)")
    print("=" * 92)
    print(f"  Value each chip given each manager's ACTUAL squad each GW; compare their real timing")
    print(f"  to optimal / random / 'biggest-double' heuristic, per half. Wildcard excluded.")
    print(f"  PRE-REGISTERED: prize real if mean(optimal-actual) >= {CP.PRIZE_MIN_PTS} (BB/TC, H2);")
    print(f"  elite already-good if capture_rate >= {CP.CAPTURE_HI}; simple rule suffices if")
    print(f"  heuristic_capture >= {CP.HEUR_HI}. Real DGWs GW26/33/36; BGWs GW31/34.\n")

    out, D, ceil = CP.run(c)

    print(f"  {'chip-half':<9}{'n':>5}{'actual':>8}{'optimal':>8}{'random':>8}{'heurs':>7}"
          f"{'LEFT':>7}{'capture':>9}{'heurCap':>9}{'mode_gw':>8}")
    for k, v in out.items():
        if v is None:
            print(f"  {k:<9}  (none)")
            continue
        h = "-" if v["heuristic"] is None else f"{v['heuristic']:.1f}"
        cap = "-" if v["capture_rate"] is None else f"{v['capture_rate']:.2f}"
        hc = "-" if v["heuristic_capture"] is None else f"{v['heuristic_capture']:.2f}"
        print(f"  {k:<9}{v['n']:>5}{v['actual']:>8.1f}{v['optimal']:>8.1f}{v['random']:>8.1f}"
              f"{h:>7}{v['left_on_table']:>+7.1f}{cap:>9}{hc:>9}{v['actual_gw_mode']:>8}")

    print("\n" + "-" * 92)
    print("  PRE-REGISTERED VERDICTS")
    print("-" * 92)
    for tag in ("BB", "TC", "FH"):
        h2 = out.get(f"{tag}-H2")
        if not h2:
            continue
        prize = h2["left_on_table"] >= CP.PRIZE_MIN_PTS
        cap = h2["capture_rate"]
        hc = h2["heuristic_capture"]
        print(f"  {tag} (H2): left on table {h2['left_on_table']:+.1f} pts -> "
              f"PRIZE {'REAL' if prize else 'small'};  "
              f"elite capture {cap if cap is not None else 'n/a'} "
              f"({'already good' if cap and cap >= CP.CAPTURE_HI else 'room to improve'});  "
              f"heuristic capture {hc if hc is not None else 'n/a'} "
              f"({'SIMPLE RULE SUFFICES' if hc and hc >= CP.HEUR_HI else 'sophistication may pay'})")
    print("\n  H1 note: first-half has NO doubles in 2025/26 (DGWs are all H2), so the H1 regime is")
    print("  'don't waste the chip', not 'time it' — heuristic is N/A there by construction.")
    print("  MY (2990380) chips: NOT computable — per-GW picks were never captured and are")
    print("  unrecoverable post-reset (404). Only aggregate points/chips exist for my entry.")

    fpl = load._fpl(c)
    fpl.table("insights").upsert({
        "slug": "chip-premise-test",
        "title": "Chip-timing premise test — is the +49 prize real on our data? (pre-registered)",
        "summary": ("Values BB/TC/FH per elite manager per GW from their ACTUAL 2025/26 squads, "
                    "comparing real timing vs optimal/random/biggest-double heuristic, per half. "
                    "Tests whether chip TIMING leaves material points on the table (the planner's "
                    "premise) and whether a SIMPLE biggest-DGW rule already captures it. Wildcard "
                    "excluded (not within-week measurable). Descriptive, single season."),
        "payload": {"results": out, "criteria": {"prize_min_pts": CP.PRIZE_MIN_PTS,
                    "capture_hi": CP.CAPTURE_HI, "heur_hi": CP.HEUR_HI},
                    "real_dgws": [26, 33, 36], "real_bgws": [31, 34],
                    "my_chips_note": "entry 2990380 per-GW picks not captured, unrecoverable post-reset"},
        "data_basis": (
            "150 top-2025/26 managers, real picks all 38 GWs. BB=bench(slots 12-15) pts; "
            "TC=best owned player's pts (the +1x); FH=best legal 1-week squad (Study 7 ILP) minus "
            "actual GW pts (approximate). Optimal/random/heuristic computed within each half using "
            "the manager's ACTUAL squad each week. Single season, descriptive, survivorship "
            "(123/150 no prior track record). Heuristic = the half's biggest-double GW for that "
            "manager; N/A in H1 (no doubles)."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'chip-premise-test' written.")


if __name__ == "__main__":
    main()
