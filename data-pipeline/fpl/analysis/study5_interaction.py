"""Study 5 — the ONE new thing: position × archetype interaction (§5.7a, tight).

Team form is null beyond baseline (Study 2 #5) and fixture-adjusted ELO→points
by position is already measured (Study 3 R1). So this does NOT re-run a study.
It answers only the genuinely new question:

  Does team strength translate to points MORE for NAILED players than ROTATION
  players, within position? (The 'premium team defence' thesis sharpened to
  'premium team NAILED defence'.)

Two channels, both reported:
  - starters (>=60 min): return GIVEN playing.
  - all rows (incl. 0-min): TOTAL value — folds in that nailed players actually
    start the good fixtures while rotation players miss them.
"""
from __future__ import annotations

import statistics
from collections import defaultdict

from ingest import load, query
from analysis import stats
from analysis import study2_factors as F
from analysis import params as P

POSITIONS = ("GKP", "DEF", "MID", "FWD")


def _archetype_map(client):
    """{(season_id, player_id) -> archetype}."""
    return {(r["season_id"], r["player_id"]): r["archetype"]
            for r in query.fetch_all(client, "player_archetypes",
                                     "season_id, player_id, archetype", filters={})}


def run(client) -> dict:
    arch = _archetype_map(client)
    rows = []
    for s in P.RECORDED_SEASONS:
        for r in F._assemble(client, s):
            if r["elo_pre"] is None or r["opp_elo_pre"] is None:
                continue
            a = arch.get((s, r["player_id"]))
            if a in ("nailed", "rotation"):
                r["rel_elo"] = r["elo_pre"] - r["opp_elo_pre"]
                r["arch"] = a
                rows.append(r)

    def corr(pos, a, starters):
        sub = [r for r in rows if r["pos"] == pos and r["arch"] == a
               and (r["minutes"] >= 60 if starters else True)]
        cell = stats.spearman_full([r["rel_elo"] for r in sub], [r["points"] for r in sub])
        # mean points on strong (rel_elo>0) vs weak fixtures
        strong = [r["points"] for r in sub if r["rel_elo"] > 0]
        weak = [r["points"] for r in sub if r["rel_elo"] <= 0]
        cell["mean_strong"] = round(statistics.mean(strong), 2) if strong else None
        cell["mean_weak"] = round(statistics.mean(weak), 2) if weak else None
        cell["strong_minus_weak"] = (round(cell["mean_strong"] - cell["mean_weak"], 2)
                                     if strong and weak else None)
        return cell

    out = {"starters": {}, "all_rows": {}}
    for channel, starters in (("starters", True), ("all_rows", False)):
        for pos in POSITIONS:
            out[channel][pos] = {a: corr(pos, a, starters) for a in ("nailed", "rotation")}
    return out


def print_and_store(client, result):
    print("=" * 68)
    print("  STUDY 5 — team strength × archetype interaction (within position)")
    print("=" * 68)
    for channel in ("starters", "all_rows"):
        label = "STARTERS (return given playing)" if channel == "starters" else "ALL ROWS (total value, incl. non-starts)"
        print(f"\n[{label}]  Spearman(fixture-relative ELO, points) + strong-vs-weak mean")
        print(f"  {'pos':<5}{'nailed rho':>12}{'nail S-W':>10}{'rot rho':>10}{'rot S-W':>10}")
        for pos in POSITIONS:
            n = result[channel][pos]["nailed"]
            r = result[channel][pos]["rotation"]
            print(f"  {pos:<5}{(n['rho'] if n['rho'] is not None else 0):>+12.3f}"
                  f"{(n['strong_minus_weak'] or 0):>+10.2f}"
                  f"{(r['rho'] if r['rho'] is not None else 0):>+10.3f}"
                  f"{(r['strong_minus_weak'] or 0):>+10.2f}")

    fpl = load._fpl(client)
    fpl.table("insights").upsert({
        "slug": "study5-team-strength-x-archetype",
        "title": "Study 5 — team strength × archetype (premium team NAILED defence)",
        "summary": ("Within position, does team strength (fixture-relative ELO) translate "
                    "to points more for NAILED than ROTATION players? Reported for both "
                    "return-given-playing (starters) and total value (all rows, folding in "
                    "that nailed players actually start the good fixtures). Consolidates "
                    "the team-strength->points-by-position result for Study 6. NOTE: team "
                    "FORM adds ~nothing beyond baseline strength (Study 2 #5, partial ~0) - "
                    "do not re-open it; the signal is team STRENGTH, not recent form."),
        "payload": result,
        "data_basis": (
            "Six seasons 2020/21-2025/26. Fixture-relative ELO = own-opp entering GW "
            "(walk-forward). Archetype from fpl.player_archetypes (that season). Only "
            "nailed/rotation compared (fringe excluded - too few starts). Effect = "
            "Spearman + strong(rel-ELO>0) vs weak mean points. Reminder: 2020/21 BCD; "
            "single-GW points ~90-99% noise (Study 3 ceiling) so rho are large-for-context."),
    }, on_conflict="slug").execute()
    print("\ninsights row 'study5-team-strength-x-archetype' written.")
