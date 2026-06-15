#!/usr/bin/env python3
"""Seed 2023 player pool from players_master_2023.csv into Supabase.

Generates a SQL DO block and runs it via supabase db query --linked.
"""

import csv
import subprocess
import sys
import unicodedata

CSV_PATH = '/Users/spinach91/Downloads/SPALtest-data/players_master_2023.csv'
SEASON_ID = 6

POSITION_GROUP = {
    'Prop':        'Front Row',
    'Hooker':      'Front Row',
    'Number 8':    'Back Row',
    'Flanker':     'Back Row',
    'Second Row':  'Other',
    'Scrum-half':  'Other',
    'Fly-half':    'Other',
    'Centre':      'Other',
    'Wing':        'Outside Back',
    'Fullback':    'Outside Back',
    'Replacement': 'Other',
}


def unaccent(s):
    """Approximate postgres unaccent: decompose then strip combining marks."""
    return ''.join(
        c for c in unicodedata.normalize('NFKD', s)
        if unicodedata.category(c) != 'Mn'
    )


def esc(s):
    return s.replace("'", "''")


def build_sql(players):
    rows = []
    for p in players:
        name = esc(p['player'])
        nation = esc(p['nation'])
        pos = esc(p['pos'])
        pg = esc(POSITION_GROUP.get(p['pos'], 'Other'))
        rows.append(f"('{name}', '{nation}', '{pos}', '{pg}')")

    values = ',\n    '.join(rows)

    return f"""
DO $$
DECLARE
  v_season_id   bigint := {SEASON_ID};
  v_new_can     int := 0;
  v_exist_can   int := 0;
  v_players_ins int := 0;
  v_prices_ins  int := 0;
  v_total       int := 0;
BEGIN
  CREATE TEMP TABLE _csv_players (
    display_name      text,
    nation            text,
    canonical_position text,
    position_group    text
  ) ON COMMIT DROP;

  INSERT INTO _csv_players (display_name, nation, canonical_position, position_group) VALUES
    {values};

  SELECT COUNT(*) INTO v_total FROM _csv_players;

  -- Insert new canonical players (no match on display_name + nation)
  INSERT INTO canonical_players (display_name, search_name, nation, canonical_position, position_group)
  SELECT
    cp.display_name,
    lower(extensions.unaccent(cp.display_name)),
    cp.nation,
    cp.canonical_position,
    cp.position_group
  FROM _csv_players cp
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical_players c
    WHERE c.display_name = cp.display_name AND c.nation = cp.nation
  );
  GET DIAGNOSTICS v_new_can = ROW_COUNT;
  v_exist_can := v_total - v_new_can;

  -- Insert season players linked to their canonical record
  INSERT INTO players (season_id, display_name, search_name, nation, canonical_position, position_group, canonical_player_id)
  SELECT
    v_season_id,
    cp.display_name,
    lower(extensions.unaccent(cp.display_name)),
    cp.nation,
    cp.canonical_position,
    cp.position_group,
    c.id
  FROM _csv_players cp
  JOIN canonical_players c ON c.display_name = cp.display_name AND c.nation = cp.nation;
  GET DIAGNOSTICS v_players_ins = ROW_COUNT;

  -- Seed base price of 10 stars per player (round_number NULL = base price)
  INSERT INTO player_prices (player_id, season_id, round_number, source_price)
  SELECT p.id, v_season_id, NULL, 10
  FROM players p
  WHERE p.season_id = v_season_id;
  GET DIAGNOSTICS v_prices_ins = ROW_COUNT;

  RAISE NOTICE 'canonical: % new, % existing | players inserted: % | prices seeded: %',
    v_new_can, v_exist_can, v_players_ins, v_prices_ins;
END;
$$;
"""


def main():
    with open(CSV_PATH, newline='', encoding='utf-8') as f:
        players = list(csv.DictReader(f))

    print(f"Read {len(players)} players from CSV")

    # Quick sanity: all positions known
    unknown = {p['pos'] for p in players if p['pos'] not in POSITION_GROUP}
    if unknown:
        print(f"ERROR: unknown positions: {unknown}", file=sys.stderr)
        sys.exit(1)

    sql = build_sql(players)

    sql_file = '/tmp/seed_2023_players.sql'
    with open(sql_file, 'w') as f:
        f.write(sql)

    print(f"Running SQL ({len(players)} players)…")
    result = subprocess.run(
        ['supabase', 'db', 'query', '--linked', sql],
        capture_output=True, text=True,
        cwd='/Users/spinach91/projects/my-website/spal-app'
    )
    print(result.stdout)
    if result.returncode != 0:
        print("STDERR:", result.stderr, file=sys.stderr)
        sys.exit(result.returncode)


if __name__ == '__main__':
    main()
