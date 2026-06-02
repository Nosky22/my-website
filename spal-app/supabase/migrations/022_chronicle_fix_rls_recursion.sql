-- Migration 022: fix infinite recursion in chronicle_comments RLS policies
--
-- Two recursion sources in 021:
-- 1. SELECT policy queries chronicle_posts — PostgreSQL re-applies RLS on that
--    table while evaluating the policy, which can cycle back.
-- 2. INSERT policy self-references chronicle_comments (to check parent is
--    top-level) — triggers the SELECT policy on chronicle_comments again,
--    causing the cycle.
--
-- Fix: security definer functions bypass RLS when querying these tables,
-- breaking both cycles.

CREATE OR REPLACE FUNCTION public.is_post_published(p_post_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chronicle_posts
    WHERE id = p_post_id AND published = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_top_level_comment(p_comment_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chronicle_comments
    WHERE id = p_comment_id AND parent_id IS NULL
  );
$$;

-- Recreate SELECT policy using security definer function
DROP POLICY "chronicle_comments_public_read" ON public.chronicle_comments;
CREATE POLICY "chronicle_comments_public_read"
  ON public.chronicle_comments
  FOR SELECT TO anon, authenticated
  USING (is_post_published(post_id));

-- Recreate INSERT policy using security definer functions for both checks
DROP POLICY "chronicle_comments_manager_insert" ON public.chronicle_comments;
CREATE POLICY "chronicle_comments_manager_insert"
  ON public.chronicle_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND is_post_published(post_id)
    AND (
      parent_id IS NULL
      OR is_top_level_comment(parent_id)
    )
  );
