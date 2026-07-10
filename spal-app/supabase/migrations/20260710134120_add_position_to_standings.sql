-- Add position column to season_standings.
-- Nullable: historical seasons are populated below; 2026 stays null and is computed live.
ALTER TABLE public.season_standings ADD COLUMN position integer;

-- 2020 (season_id=7): positions from historical_standings.csv (only source — zero points data).
-- PAUL (10th) was a guest manager with no profile row; skipped.
UPDATE public.season_standings AS ss
SET position = v.pos
FROM (VALUES
  ('d70cbbd6-384d-4d0b-82b5-7721dd805c62'::uuid, 1),  -- Jonners
  ('6ea3caf0-9ca2-4bdb-a9c6-54c237c3f30e'::uuid, 2),  -- Gman
  ('9b62f7ce-9d2f-49a5-83ac-faa2d59c451e'::uuid, 3),  -- Toalie
  ('c474c1cb-0f7a-46bb-a161-d1b49464cf72'::uuid, 4),  -- Chris
  ('cac89c60-3c14-465f-896a-77027c253ec4'::uuid, 5),  -- Tommy T
  ('821cb014-e471-4e2c-a763-cf4918c50f84'::uuid, 6),  -- BFK
  ('68c854c4-22c3-4a8b-ae54-b5217ece6456'::uuid, 7),  -- Nick
  ('63cd640c-225e-465c-9cf6-f86ca1384c76'::uuid, 8),  -- TFK
  ('0fe33fb9-d271-46d9-b394-4d2a0b7f7f0b'::uuid, 9)   -- Laura
) AS v(profile_id, pos)
WHERE ss.season_id = 7 AND ss.profile_id = v.profile_id;

-- 2021/2022/2023 (season_ids 8, 9, 6): compute from real total_points and h2h_points data.
-- CSV positions for these years contained errors (BFK misranked in 2021, TOALIE/TFK swapped
-- in 2022, 2023 CSV predates app dry-run data). Points data is authoritative.
UPDATE public.season_standings ss
SET position = ranked.pos
FROM (
  SELECT
    id,
    RANK() OVER (PARTITION BY season_id ORDER BY total_points DESC, h2h_points DESC) AS pos
  FROM public.season_standings
  WHERE season_id IN (6, 8, 9)
) ranked
WHERE ss.id = ranked.id;

-- 2024 (season_id=10): positions from historical_standings.csv (only source — zero points data).
-- BFK did not participate in 2024 and has no season_standings row.
UPDATE public.season_standings AS ss
SET position = v.pos
FROM (VALUES
  ('cac89c60-3c14-465f-896a-77027c253ec4'::uuid, 1),  -- Tommy T
  ('d70cbbd6-384d-4d0b-82b5-7721dd805c62'::uuid, 2),  -- Jonners
  ('0fe33fb9-d271-46d9-b394-4d2a0b7f7f0b'::uuid, 3),  -- Laura
  ('63cd640c-225e-465c-9cf6-f86ca1384c76'::uuid, 4),  -- TFK
  ('9b62f7ce-9d2f-49a5-83ac-faa2d59c451e'::uuid, 5),  -- Toalie
  ('68c854c4-22c3-4a8b-ae54-b5217ece6456'::uuid, 6),  -- Nick
  ('6ea3caf0-9ca2-4bdb-a9c6-54c237c3f30e'::uuid, 7),  -- Gman
  ('c474c1cb-0f7a-46bb-a161-d1b49464cf72'::uuid, 8)   -- Chris
) AS v(profile_id, pos)
WHERE ss.season_id = 10 AND ss.profile_id = v.profile_id;

-- 2025 (season_id=11): positions derived from 2026 draft order (historical_standings.csv).
-- BFK and Toalie did not participate in 2025 and have no season_standings rows.
UPDATE public.season_standings AS ss
SET position = v.pos
FROM (VALUES
  ('0fe33fb9-d271-46d9-b394-4d2a0b7f7f0b'::uuid, 1),  -- Laura
  ('68c854c4-22c3-4a8b-ae54-b5217ece6456'::uuid, 2),  -- Nick
  ('cac89c60-3c14-465f-896a-77027c253ec4'::uuid, 3),  -- Tommy T
  ('d70cbbd6-384d-4d0b-82b5-7721dd805c62'::uuid, 4),  -- Jonners
  ('63cd640c-225e-465c-9cf6-f86ca1384c76'::uuid, 5),  -- TFK
  ('c474c1cb-0f7a-46bb-a161-d1b49464cf72'::uuid, 6),  -- Chris
  ('6ea3caf0-9ca2-4bdb-a9c6-54c237c3f30e'::uuid, 7)   -- Gman
) AS v(profile_id, pos)
WHERE ss.season_id = 11 AND ss.profile_id = v.profile_id;
