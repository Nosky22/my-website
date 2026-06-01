-- Migration 021: chronicle_posts and chronicle_comments tables
-- Blog at /spal/chronicle. Posts are markdown. Comments support one level of replies.
-- Hard delete for all — when a parent comment is deleted, replies cascade.

-- ── chronicle_posts ────────────────────────────────────────────────────────────

CREATE TABLE public.chronicle_posts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         text        NOT NULL UNIQUE,
  title        text        NOT NULL,
  body         text        NOT NULL,
  author_id    uuid        NOT NULL REFERENCES public.profiles(id),
  published    boolean     NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chronicle_posts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER chronicle_posts_updated_at
  BEFORE UPDATE ON public.chronicle_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Public can read published posts only.
CREATE POLICY "chronicle_posts_public_read"
  ON public.chronicle_posts
  FOR SELECT TO anon, authenticated
  USING (published = true);

-- Admin full access (create, edit, publish, delete).
CREATE POLICY "chronicle_posts_admin_all"
  ON public.chronicle_posts
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- ── chronicle_comments ─────────────────────────────────────────────────────────

CREATE TABLE public.chronicle_comments (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id   bigint NOT NULL REFERENCES public.chronicle_posts(id) ON DELETE CASCADE,
  parent_id bigint REFERENCES public.chronicle_comments(id) ON DELETE CASCADE,
  author_id uuid   NOT NULL REFERENCES public.profiles(id),
  body      text   NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chronicle_comments ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER chronicle_comments_updated_at
  BEFORE UPDATE ON public.chronicle_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Public can read comments on published posts.
CREATE POLICY "chronicle_comments_public_read"
  ON public.chronicle_comments
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chronicle_posts
      WHERE id = chronicle_comments.post_id AND published = true
    )
  );

-- Authenticated users can comment on published posts.
-- Replies must reference a top-level comment (no nesting beyond one level).
CREATE POLICY "chronicle_comments_manager_insert"
  ON public.chronicle_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM public.chronicle_posts
      WHERE id = post_id AND published = true
    )
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.chronicle_comments c
        WHERE c.id = parent_id AND c.parent_id IS NULL
      )
    )
  );

-- Users can delete their own comments (replies also deleted via cascade).
CREATE POLICY "chronicle_comments_manager_delete"
  ON public.chronicle_comments
  FOR DELETE TO authenticated
  USING (auth.uid() = author_id);

-- Admin full access.
CREATE POLICY "chronicle_comments_admin_all"
  ON public.chronicle_comments
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
