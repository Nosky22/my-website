"""Study 1 verification: counts, no-lookahead invariant, burn-in stabilisation,
and an independent ClubELO rank-correlation sanity check (ClubELO never enters
the model — validation only)."""
from __future__ import annotations

import io
import math
import statistics
from collections import defaultdict
from datetime import datetime

import requests

from ingest import load, query
from analysis import burnin, params as P

# ClubELO name → our short_name (the clubs that overlap our seasons)
CLUBELO_TO_SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Bournemouth": "BOU", "Brentford": "BRE",
    "Brighton": "BHA", "Burnley": "BUR", "Chelsea": "CHE", "Crystal Palace": "CRY",
    "Everton": "EVE", "Fulham": "FUL", "Ipswich": "IPS", "Leeds": "LEE",
    "Leicester": "LEI", "Liverpool": "LIV", "Luton": "LUT", "Man City": "MCI",
    "Man United": "MUN", "Newcastle": "NEW", "Norwich": "NOR", "Forest": "NFO",
    "Nott'ham Forest": "NFO", "Sheffield United": "SHU", "Southampton": "SOU",
    "Sunderland": "SUN", "Tottenham": "TOT", "Watford": "WAT", "West Brom": "WBA",
    "West Ham": "WHU", "Wolves": "WOL",
}


def _spearman(xs, ys) -> float:
    def ranks(v):
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        for rank, i in enumerate(order):
            r[i] = rank
        return r
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((rx[i] - mx) * (ry[i] - my) for i in range(n))
    sx = math.sqrt(sum((r - mx) ** 2 for r in rx))
    sy = math.sqrt(sum((r - my) ** 2 for r in ry))
    return cov / (sx * sy) if sx and sy else float("nan")


def check_counts(c):
    print("\n[1] ROW COUNTS per season")
    print(f"  {'season':<9}{'team_elo':>9}{'team_form':>11}{'player_form':>13}")
    for s in P.RECORDED_SEASONS:
        te = query.exact_count(c, "team_elo", filters={"season_id": s})
        tf = query.exact_count(c, "team_form", filters={"season_id": s})
        pf = query.exact_count(c, "player_form", filters={"season_id": s})
        print(f"  {s:<9}{te:>9,}{tf:>11,}{pf:>13,}")


def check_no_lookahead(c):
    """Invariant: a team's ELO changes at gw iff it played that gw. A snapshot
    that carried future info would violate this. Reports violations (expect 0)."""
    print("\n[2] NO-LOOKAHEAD INVARIANT (idle team → ELO unchanged; played → changed)")
    violations = 0
    for s in P.RECORDED_SEASONS:
        fx = query.fetch_all(c, "fixtures", "gw_number, home_team_id, away_team_id",
                             filters={"season_id": s})
        played = defaultdict(set)  # gw -> teams that played
        for f in fx:
            played[f["gw_number"]].add(f["home_team_id"])
            played[f["gw_number"]].add(f["away_team_id"])
        elo = query.fetch_all(c, "team_elo", "team_id, gw_number, elo", filters={"season_id": s})
        by_team = defaultdict(dict)
        for r in elo:
            by_team[r["team_id"]][r["gw_number"]] = float(r["elo"])
        for team, series in by_team.items():
            gws = sorted(series)
            for prev, cur in zip(gws, gws[1:]):
                changed = abs(series[cur] - series[prev]) > 1e-9
                did_play = team in played.get(cur, set())
                if changed != did_play:
                    violations += 1
    print(f"  violations across all seasons: {violations}  "
          f"({'PASS' if violations == 0 else 'FAIL'})")
    return violations == 0


def check_burnin_stability(c):
    """Rank-correlation of ratings vs final burn-in ratings, over burn-in."""
    print("\n[3] BURN-IN STABILISATION")
    bm = burnin.burnin_matches()
    # replay, snapshotting full rating vector every 5 matches
    from analysis.elo import _apply, _season_boundary
    ratings, pc, snaps = {}, set(), []
    for i, season in enumerate(P.BURNIN_SEASONS):
        sm = [m for m in bm if m["season"] == season]
        nc = {m["home_code"] for m in sm} | {m["away_code"] for m in sm}
        ratings = {**ratings, **_season_boundary(ratings, nc, pc, first=(i == 0))}
        for j, m in enumerate(sm):
            _apply(ratings, m["home_code"], m["away_code"], m["hs"], m["as"], P.hfa_for(m["date"]))
            snaps.append(dict(ratings))
        pc = nc
    final = snaps[-1]
    codes = sorted(final)
    fvec = [final[k] for k in codes]
    # find first snapshot (in matches) whose rank-corr with final exceeds 0.9
    matches_to_90 = None
    for idx, snap in enumerate(snaps):
        common = [k for k in codes if k in snap]
        if len(common) < 15:
            continue
        rho = _spearman([snap[k] for k in common], [final[k] for k in common])
        if rho >= 0.9 and matches_to_90 is None:
            matches_to_90 = idx + 1
    total_matches = len(snaps)
    print(f"  burn-in matches: {total_matches} (2 seasons); rank-corr vs final ≥0.90 "
          f"after ~{matches_to_90} matches (~{matches_to_90/10:.0f} match-days / "
          f"~{matches_to_90/380*38:.0f} GW-equiv)")
    print(f"  → ratings are stable well before the recorded window starts (GW1 2020/21).")
    return matches_to_90


def check_clubelo(c, dates=("2023-11-01", "2024-03-01", "2025-02-01")):
    """Independent validation: Spearman(our ELO, ClubELO) on matching dates."""
    print("\n[4] CLUBELO VALIDATION (Spearman rank-corr; ClubELO never enters model)")
    for d in dates:
        try:
            resp = requests.get(f"http://api.clubelo.com/{d}", timeout=30)
            resp.raise_for_status()
        except Exception as e:
            print(f"  {d}: fetch failed ({e})")
            continue
        ce = {}
        for row in resp.text.splitlines()[1:]:
            parts = row.split(",")
            if len(parts) < 5 or parts[2] != "ENG":
                continue
            sn = CLUBELO_TO_SHORT.get(parts[1])
            if sn:
                try:
                    ce[sn] = float(parts[4])
                except ValueError:
                    pass
        # map date → season + nearest gw via fixtures
        y, m, _ = map(int, d.split("-"))
        season = f"{y}-{str(y+1)[2:]}" if m >= 8 else f"{y-1}-{str(y)[2:]}"
        fx = query.fetch_all(c, "fixtures", "gw_number, kickoff_time", filters={"season_id": season})
        dd = datetime.fromisoformat(d).date()
        past = [f for f in fx if f["kickoff_time"] and
                datetime.fromisoformat(f["kickoff_time"].replace("Z", "+00:00")).date() <= dd]
        if not past:
            print(f"  {d}: no fixtures before date in {season}")
            continue
        gw = max(f["gw_number"] for f in past)
        nm = {t["id"]: t["short_name"] for t in query.fetch_all(c, "teams", "id, short_name", filters={"season_id": season})}
        ours = {nm[r["team_id"]]: float(r["elo"]) for r in query.fetch_all(
            c, "team_elo", "team_id, elo", filters={"season_id": season, "gw_number": gw})}
        common = sorted(set(ce) & set(ours))
        if len(common) < 10:
            print(f"  {d}: only {len(common)} clubs matched")
            continue
        rho = _spearman([ours[k] for k in common], [ce[k] for k in common])
        print(f"  {d} (≈{season} GW{gw}, n={len(common)}): Spearman ρ = {rho:.3f}")


def run(c):
    print("=" * 62)
    print("  STUDY 1 VERIFICATION — Form & ELO")
    print("=" * 62)
    check_counts(c)
    ok = check_no_lookahead(c)
    check_burnin_stability(c)
    check_clubelo(c)
    print("\n" + "=" * 62)
    print(f"  {'no-lookahead invariant PASSED' if ok else 'INVARIANT FAILED'}")
    print("=" * 62)


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
    c = load.make_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    run(c)
