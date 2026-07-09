-- migration 026: relax draft_picks constraints for historical season support
--
-- The UNIQUE (season_id, profile_id, draft_slot) constraint and NOT NULL on
-- draft_slot were designed for the live 2026 draft system (one pick per slot
-- per manager). Historical seasons had different slot structures: overlapping
-- categories, incomplete slot data (2022 all Unknown), and slot types that
-- don't map to the current five values (Centre, Second Row, Italy picks).
--
-- Changes:
--   1. Make draft_slot nullable — historical picks with no slot data store NULL
--   2. Update check constraint to allow NULL (valid values unchanged)
--   3. Drop draft_picks_slot_unique — live-season enforcement is at app/Edge
--      Function layer; the constraint has no meaning across historical records
--
-- draft_picks_player_unique (season_id, player_id) is unchanged.

ALTER TABLE public.draft_picks
    ALTER COLUMN draft_slot DROP NOT NULL;

ALTER TABLE public.draft_picks
    DROP CONSTRAINT draft_picks_draft_slot_check;

ALTER TABLE public.draft_picks
    ADD CONSTRAINT draft_picks_draft_slot_check
    CHECK (draft_slot IS NULL OR draft_slot = ANY (
        ARRAY['Front Row'::text, 'Back Row'::text, 'Outside Back'::text, 'Wales'::text, 'Bench Sub'::text]
    ));

ALTER TABLE public.draft_picks
    DROP CONSTRAINT draft_picks_slot_unique;
