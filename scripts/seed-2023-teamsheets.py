#!/usr/bin/env python3
"""Seed 2023 matchday squads from teamsheets_2023_r[1-5].csv."""

import csv
import json
import subprocess
import sys

SEASON_ID = 6
CSV_DIR = '/Users/spinach91/Downloads/SPALtest-data'


def run_sql(sql, cwd='/Users/spinach91/projects/my-website/spal-app'):
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql],
        capture_output=True, text=True, cwd=cwd
    )
    if result.returncode != 0:
        print('SQL ERROR:', result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def esc(s):
    return s.replace("'", "''")


def main():
    # ── Fetch players (display_name, nation) → player_id ─────────────────
    data = run_sql(f"""
SELECT id, display_name, nation FROM players WHERE season_id = {SEASON_ID};
""")
    players = {(r['display_name'], r['nation']): r['id'] for r in data['rows']}
    print(f"Loaded {len(players)} season 2023 players")

    # ── Fetch matches (round_number, home_nation, away_nation) → match_id ─
    data = run_sql(f"""
SELECT id, round_number, home_nation, away_nation
FROM matches WHERE season_id = {SEASON_ID};
""")
    # Index by (round, nation) for both home and away
    match_by_round_nation = {}
    for r in data['rows']:
        match_by_round_nation[(r['round_number'], r['home_nation'])] = r['id']
        match_by_round_nation[(r['round_number'], r['away_nation'])]  = r['id']
    print(f"Loaded {len(data['rows'])} matches")

    grand_total = 0

    for rnd in range(1, 6):
        path = f"{CSV_DIR}/teamsheets_2023_r{rnd}.csv"
        with open(path, newline='', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))

        matched, unmatched = [], []

        for row in rows:
            nation = row['nation'].strip()
            name   = row['player'].strip()
            status = row['status'].strip()
            jersey = row['jersey'].strip()

            player_id = players.get((name, nation))
            match_id  = match_by_round_nation.get((rnd, nation))

            if player_id is None:
                unmatched.append((nation, name, 'player not in season pool'))
                continue
            if match_id is None:
                unmatched.append((nation, name, f'no match for round {rnd} + nation {nation}'))
                continue

            matched.append((match_id, player_id, esc(status), int(jersey)))

        print(f"\nRound {rnd}: {len(matched)} matched, {len(unmatched)} unmatched")
        if unmatched:
            for nation, name, reason in unmatched:
                print(f"  UNMATCHED [{nation}] {name} — {reason}")

        if not matched:
            continue

        values = ', '.join(
            f"({mid}, {pid}, '{st}', {jersey}, 'csv_import', now())"
            for mid, pid, st, jersey in matched
        )

        run_sql(f"""
INSERT INTO matchday_squads (match_id, player_id, status, shirt_number, source, imported_at)
VALUES {values}
ON CONFLICT (match_id, player_id) DO UPDATE
  SET status       = EXCLUDED.status,
      shirt_number = EXCLUDED.shirt_number,
      updated_at   = now();
""")
        grand_total += len(matched)

    result = run_sql(f"""
SELECT COUNT(*) AS total
FROM matchday_squads ms
JOIN matches m ON m.id = ms.match_id
WHERE m.season_id = {SEASON_ID};
""")
    db_total = result['rows'][0]['total']
    print(f"\nTotal matchday_squads rows for season 2023 (from DB): {db_total}")


if __name__ == '__main__':
    main()
