#!/usr/bin/env python3
"""Study 1 — Form & ELO. Orchestrates the three derived tables + provenance.

Idempotent: every step upserts on natural keys, so re-running is safe.

Usage:
  python -m analysis.run_study1            # full: elo + team_form + player_form + provenance + verify
  python -m analysis.run_study1 --verify   # verification only
"""
from __future__ import annotations

import argparse
import json
import logging
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from ingest import load
from analysis import elo, team_form, player_form, verify_study1, params as P

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def write_provenance(client, elo_diag: dict) -> None:
    """Record Study 1's model, parameters, and caveats in fpl.insights."""
    row = {
        "slug": "study1-form-elo-provenance",
        "title": "Study 1 — Team ELO & rolling form (model provenance)",
        "summary": (
            "Six-season team ELO (warmed by 2018-19+2019-20 burn-in) plus rolling "
            "team form (last-6/10) and player form (last-4/6). Walk-forward, no "
            "lookahead. Feeds Studies 2-8 and the season-path planner."
        ),
        "payload": {
            "elo_params": elo_diag.get("params", {}),
            "hfa_regimes": {
                "normal": {"elo": P.HFA_NORMAL, "ci95": [26.6, 73.4],
                           "fit_from": "2018-19 + 2019-20 pre-restart (N=668)"},
                "behind_closed_doors": {
                    "elo": P.HFA_BCD, "ci95": [-7.6, 121.8],
                    "fit_from": "2019-20 post-restart (N=92)",
                    "note": ("walk-forward bcd fit is uninformative (CI swallows zero "
                             "and the normal estimate); defaulted to normal. 2020/21 "
                             "flagged behind_closed_doors — ratings over-credit home form.")},
            },
            "burnin": {"seasons": P.BURNIN_SEASONS,
                       "matches": 760,
                       "rank_corr_0.90_after_matches": elo_diag.get("stabilise_matches")},
            "windows": {"team": list(P.TEAM_FORM_WINDOWS), "player": list(P.PLAYER_FORM_WINDOWS)},
            "xpts_model": "independent Poisson from player-aggregated match xG",
        },
        "data_basis": (
            "Seasons 2020/21-2025/26 (recorded), warmed by 2018/19+2019/20 (vaastav). "
            "data_tier: 2020/21-2021/22 no_xg (xPts/xGI null), 2022/23+ full_xg. "
            "CAVEATS: (1) 2020/21 played behind closed doors — home advantage collapsed "
            "(measured HFA -8.2) but this was unknowable ex-ante; its ELO over-credits "
            "home form (crowd_conditions flag). (2) Independent-Poisson xPts under-predicts "
            "draws (Dixon-Coles deficiency); relative pts_vs_xpts stays valid, absolute "
            "xPts carries the bias. (3) ClubELO cross-validation coded but pending "
            "(endpoint unreachable in build env). (4) 2022/23 has 37 GWs (GW7 blank)."
        ),
    }
    load._fpl(client).table("insights").upsert(row, on_conflict="slug").execute()
    logging.info("provenance insights row upserted (study1-form-elo-provenance)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Study 1 — Form & ELO")
    ap.add_argument("--verify", action="store_true", help="verification only")
    args = ap.parse_args()
    client = load.make_client(SUPABASE_URL, SERVICE_KEY)

    if not args.verify:
        diag = elo.run(client)
        diag["stabilise_matches"] = verify_study1.check_burnin_stability(client)
        team_form.run(client)
        player_form.run(client)
        write_provenance(client, diag)

    verify_study1.run(client)


if __name__ == "__main__":
    main()
