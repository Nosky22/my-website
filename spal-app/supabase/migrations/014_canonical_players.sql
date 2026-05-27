-- 014_canonical_players.sql
-- Creates canonical_players as the stable real-world identity record for players
-- across seasons. Adds a nullable canonical_player_id FK to the existing players
-- table, populates canonical_players from existing players data (dedup key:
-- display_name + nation), and links all rows.
--
-- Entirely additive: no existing columns dropped, no data deleted, no existing
-- constraints changed. canonical_player_id is nullable; the NOT NULL constraint
-- is deferred to migration 015 after verifying all rows are linked.

-- ── 1. Enable unaccent extension ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ── 2. Create canonical_players ──────────────────────────────────────────────
CREATE TABLE public.canonical_players (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name       text        NOT NULL,
  search_name        text        NOT NULL,
  nation             text        NOT NULL
    CHECK (nation = ANY (ARRAY['England','Ireland','Scotland','Wales','France','Italy'])),
  canonical_position text        NOT NULL,
  position_group     text        NOT NULL
    CHECK (position_group = ANY (ARRAY['Front Row','Back Row','Outside Back','Other'])),
  active             boolean     NOT NULL DEFAULT true,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_players_display_name_nation_key UNIQUE (display_name, nation)
);

CREATE TRIGGER canonical_players_updated_at
  BEFORE UPDATE ON public.canonical_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX canonical_players_search_name_idx ON public.canonical_players (search_name);
CREATE INDEX canonical_players_nation_idx       ON public.canonical_players (nation);

-- ── 3. Add canonical_player_id to players ────────────────────────────────────
ALTER TABLE public.players
  ADD COLUMN canonical_player_id bigint REFERENCES public.canonical_players (id);

CREATE INDEX players_canonical_player_id_idx ON public.players (canonical_player_id);

-- ── 4. Populate canonical_players ────────────────────────────────────────────
-- DISTINCT ON (display_name, nation) ORDER BY season_id DESC picks the most
-- recent season's position for each unique player identity.
INSERT INTO public.canonical_players
  (display_name, search_name, nation, canonical_position, position_group)
SELECT DISTINCT ON (p.display_name, p.nation)
  p.display_name,
  lower(extensions.unaccent(p.display_name)),
  p.nation,
  p.canonical_position,
  p.position_group
FROM public.players p
ORDER BY p.display_name, p.nation, p.season_id DESC;

-- ── 5. Link players rows to canonical_players ─────────────────────────────────
UPDATE public.players p
SET canonical_player_id = cp.id
FROM public.canonical_players cp
WHERE p.display_name = cp.display_name
  AND p.nation       = cp.nation;

-- ── 6. Enable RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.canonical_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canonical_players_anon_read"
  ON public.canonical_players FOR SELECT TO anon
  USING (true);

CREATE POLICY "canonical_players_authenticated_read"
  ON public.canonical_players FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "canonical_players_admin_insert"
  ON public.canonical_players FOR INSERT TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "canonical_players_admin_update"
  ON public.canonical_players FOR UPDATE TO authenticated
  USING (is_admin());

CREATE POLICY "canonical_players_admin_delete"
  ON public.canonical_players FOR DELETE TO authenticated
  USING (is_admin());
