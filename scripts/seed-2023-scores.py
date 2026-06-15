#!/usr/bin/env python3
"""Seed player match scores for a given round of season 2023.

Usage: python3 seed-2023-scores.py [round_number]
Default: round 1 only.

Designed to be re-run as each round's scores become available.
"""

import csv
import json
import subprocess
import sys

CSV_PATH = '/Users/spinach91/Downloads/SPALtest-data/player_scores_2023_all_rounds.csv'
SEASON_ID = 6


def run_sql(sql, cwd='/Users/spinach91/projects/my-website/spal-app'):
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql],
        capture_output=True, text=True, cwd=cwd
    )
    if result.returncode != 0:
        print('SQL ERROR:', result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def main():
    target_round = int(sys.argv[1]) if len(sys.argv) > 1 else 1

    # ── Load season players ───────────────────────────────────────────────
    data = run_sql(f"SELECT id, display_name, nation FROM players WHERE season_id = {SEASON_ID};")
    players = {(r['display_name'], r['nation']): r['id'] for r in data['rows']}

    # ── Load season matches ───────────────────────────────────────────────
    data = run_sql(f"SELECT id, round_number, home_nation, away_nation FROM matches WHERE season_id = {SEASON_ID};")
    match_by_round_nation = {}
    for r in data['rows']:
        match_by_round_nation[(r['round_number'], r['home_nation'])] = r['id']
        match_by_round_nation[(r['round_number'], r['away_nation'])]  = r['id']

    # ── Read CSV, filter to target round ─────────────────────────────────
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        all_rows = list(csv.DictReader(f))

    round_rows = [r for r in all_rows if int(r['round']) == target_round]
    print(f"Round {target_round}: {len(round_rows)} rows in CSV")

    matched, unmatched = [], []
    for row in round_rows:
        nation = row['nation'].strip()
        name   = row['player'].strip()
        points = row['points'].strip()

        player_id = players.get((name, nation))
        match_id  = match_by_round_nation.get((target_round, nation))

        if player_id is None:
            unmatched.append((nation, name, 'player not in season pool'))
            continue
        if match_id is None:
            unmatched.append((nation, name, f'no match for round {target_round} + {nation}'))
            continue

        matched.append((match_id, player_id, float(points)))

    print(f"  Matched: {len(matched)}, Unmatched: {len(unmatched)}")
    if unmatched:
        print("  UNMATCHED:")
        for nation, name, reason in unmatched:
            print(f"    [{nation}] {name} — {reason}")

    if not matched:
        print("Nothing to insert.")
        return

    values = ', '.join(
        f"({mid}, {pid}, {SEASON_ID}, {pts}, 'provisional', now())"
        for mid, pid, pts in matched
    )

    run_sql(f"""
INSERT INTO player_match_scores (match_id, player_id, season_id, source_points, status, imported_at)
VALUES {values}
ON CONFLICT (match_id, player_id) DO UPDATE
  SET source_points = EXCLUDED.source_points,
      status        = EXCLUDED.status,
      updated_at    = now();
""")

    result = run_sql(f"""
SELECT COUNT(*) AS total
FROM player_match_scores pms
JOIN matches m ON m.id = pms.match_id
WHERE m.season_id = {SEASON_ID} AND m.round_number = {target_round};
""")
    db_count = result['rows'][0]['total']
    print(f"  Rows now in DB for round {target_round}: {db_count}")


if __name__ == '__main__':
    main()
