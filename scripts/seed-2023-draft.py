#!/usr/bin/env python3
"""Seed 2023 draft data: draft_order, draft_session, draft_picks.

Excludes BFK and TOALIE. Maps abbreviated player names to season 2023
players table via surname / override lookup.
"""

import csv
import json
import subprocess
import sys

CSV_PATH = '/Users/spinach91/Downloads/SPALtest-data/draft_2023.csv'
SEASON_ID = 6

EXCLUDE = {'BFK', 'TOALIE', 'ROUNDS'}

MANAGER_PROFILES = {
    'NICK':    '68c854c4-22c3-4a8b-ae54-b5217ece6456',
    'JONNERS': 'd70cbbd6-384d-4d0b-82b5-7721dd805c62',
    'LAURA':   '0fe33fb9-d271-46d9-b394-4d2a0b7f7f0b',
    'CHRIS':   'c474c1cb-0f7a-46bb-a161-d1b49464cf72',
    'GMAN':    '6ea3caf0-9ca2-4bdb-a9c6-54c237c3f30e',
    'TFK':     '63cd640c-225e-465c-9cf6-f86ca1384c76',
    'TOMMY T': 'cac89c60-3c14-465f-896a-77027c253ec4',
}

SLOT_MAP = {
    'OB':       'Outside Back',
    'BR':       'Back Row',
    'Prop':     'Front Row',
    'Italian':  'Wales',
    'Finisher': 'Bench Sub',
}

# Abbreviated name → exact display_name in season 2023 players table
NAME_OVERRIDES = {
    'JVDF':      'Josh van der Flier',
    'Duhan VDM': 'Duhan van der Merwe',
    'Aldritt':   'Gregory Alldritt',   # typo in source
    'Dominator': 'Alex Dombrandt',     # nickname
    'Nell':      'WP Nel',             # initials-only name
    'N Cannone': 'Niccolo Cannone',
    'A Watson':  'Anthony Watson',
    'C Harris':  'Chris Harris',
    'J Lowe':    'James Lowe',
    'J Ritchie': 'Jamie Ritchie',
}


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
    # ── 1. Fetch all season 2023 players (id, display_name) ──────────────
    data = run_sql(f"SELECT id, display_name FROM players WHERE season_id = {SEASON_ID};")
    players_by_name = {row['display_name']: row['id'] for row in data['rows']}
    # Also index by last word of display_name (surname fallback)
    players_by_surname = {}
    for name, pid in players_by_name.items():
        surname = name.split()[-1]
        if surname in players_by_surname:
            players_by_surname[surname] = None  # ambiguous — require override
        else:
            players_by_surname[surname] = (name, pid)

    # ── 2. Read CSV, filter to 7 managers ────────────────────────────────
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        picks_raw = list(csv.DictReader(f))

    picks = [p for p in picks_raw if p['manager'] not in EXCLUDE]
    print(f"Picks after filtering: {len(picks)} (expected 35)")

    # ── 3. Match player names → player_ids ───────────────────────────────
    unmatched = []
    resolved = []
    for row in picks:
        abbrev = row['player'].strip()
        # Try exact override first
        if abbrev in NAME_OVERRIDES:
            full_name = NAME_OVERRIDES[abbrev]
            if full_name not in players_by_name:
                unmatched.append((row['manager'], abbrev, 'override not in DB'))
                continue
            pid = players_by_name[full_name]
        # Try exact display_name match
        elif abbrev in players_by_name:
            pid = players_by_name[abbrev]
            full_name = abbrev
        # Try surname (last word) match
        else:
            surname = abbrev.split()[-1]
            match = players_by_surname.get(surname)
            if not match:
                unmatched.append((row['manager'], abbrev, 'no surname match'))
                continue
            full_name, pid = match

        resolved.append({
            'manager':  row['manager'],
            'slot_raw': row['slot'].strip(),
            'abbrev':   abbrev,
            'full_name': full_name,
            'player_id': pid,
        })

    if unmatched:
        print('\nUNMATCHED PLAYERS:')
        for m, n, reason in unmatched:
            print(f'  {m}: "{n}" — {reason}')
    else:
        print('All player names matched.')

    if len(resolved) != 35:
        print(f'ERROR: expected 35 resolved picks, got {len(resolved)}', file=sys.stderr)
        sys.exit(1)

    # ── 4. Update season_rules: add slot_bench_sub_enabled = true ────────
    print('\nUpdating season_rules: slot_bench_sub_enabled = true ...')
    run_sql(f"""
UPDATE season_rules
SET rules = rules || '{{"slot_bench_sub_enabled": true}}'::jsonb
WHERE season_id = {SEASON_ID};
""")

    # ── 5. Insert draft_order (alphabetical by manager key) ───────────────
    print('Inserting draft_order ...')
    ordered_managers = sorted(MANAGER_PROFILES.items())  # alphabetical by key
    order_vals = ', '.join(
        f"({SEASON_ID}, {pos + 1}, '{pid}')"
        for pos, (_, pid) in enumerate(ordered_managers)
    )
    run_sql(f"""
INSERT INTO draft_order (season_id, pick_position, profile_id) VALUES {order_vals};
""")

    # ── 6. Insert draft_session ───────────────────────────────────────────
    print('Inserting draft_session ...')
    run_sql(f"""
INSERT INTO draft_sessions (season_id, status, current_pick_number, pick_timer_seconds,
  started_at, completed_at)
VALUES ({SEASON_ID}, 'complete', 35, 60,
  '2023-01-01 12:00:00+00', '2023-01-01 13:00:00+00');
""")

    # ── 7. Insert draft_picks ─────────────────────────────────────────────
    print('Inserting 35 draft_picks ...')
    # Order: by slot round (OB first, then BR, Prop, Italian, Finisher),
    # then alphabetically by manager — gives a natural pick_number sequence.
    slot_order = ['OB', 'BR', 'Prop', 'Italian', 'Finisher']
    resolved.sort(key=lambda r: (slot_order.index(r['slot_raw']), r['manager']))

    pick_vals = []
    for i, r in enumerate(resolved, start=1):
        profile_id = MANAGER_PROFILES[r['manager']]
        draft_slot = esc(SLOT_MAP[r['slot_raw']])
        pick_vals.append(
            f"({SEASON_ID}, '{profile_id}', {r['player_id']}, {i}, '{draft_slot}', now())"
        )

    run_sql(f"""
INSERT INTO draft_picks (season_id, profile_id, player_id, pick_number, draft_slot, picked_at)
VALUES {', '.join(pick_vals)};
""")

    # ── 8. Verification query ─────────────────────────────────────────────
    result = run_sql(f"""
SELECT
  (SELECT COUNT(*) FROM draft_order   WHERE season_id = {SEASON_ID}) AS draft_order_rows,
  (SELECT COUNT(*) FROM draft_sessions WHERE season_id = {SEASON_ID}) AS draft_session_rows,
  (SELECT COUNT(*) FROM draft_picks    WHERE season_id = {SEASON_ID}) AS draft_pick_rows;
""")
    counts = result['rows'][0]
    print(f"\nVerification:")
    print(f"  draft_order rows:   {counts['draft_order_rows']}")
    print(f"  draft_session rows: {counts['draft_session_rows']}")
    print(f"  draft_pick rows:    {counts['draft_pick_rows']}")

    # ── 9. Print resolved pick table ─────────────────────────────────────
    print('\nResolved picks:')
    print(f"  {'#':<3} {'Manager':<9} {'Slot':<14} {'Abbrev':<12} {'Full name'}")
    for i, r in enumerate(resolved, start=1):
        slot_label = SLOT_MAP[r['slot_raw']]
        print(f"  {i:<3} {r['manager']:<9} {slot_label:<14} {r['abbrev']:<12} {r['full_name']}")


if __name__ == '__main__':
    main()
