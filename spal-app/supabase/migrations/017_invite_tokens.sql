-- Invite gate: only holders of a valid unclaimed token may sign up.

CREATE TABLE public.invite_tokens (
  id          bigint generated always as identity primary key,
  token       text not null unique,
  created_by  uuid not null references public.profiles(id),
  claimed_by  uuid references public.profiles(id),
  claimed_at  timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

-- Admin: full read/write
CREATE POLICY "invite_tokens_admin_all" ON public.invite_tokens
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Anon: read unclaimed tokens so the signup form can verify a token
-- before an account exists.
CREATE POLICY "invite_tokens_anon_read_unclaimed" ON public.invite_tokens
  FOR SELECT TO anon
  USING (claimed_by IS NULL);

-- Authenticated: claim an unclaimed token — may only set claimed_by
-- to their own user id.
CREATE POLICY "invite_tokens_authenticated_claim" ON public.invite_tokens
  FOR UPDATE TO authenticated
  USING (claimed_by IS NULL)
  WITH CHECK (claimed_by = auth.uid());

-- Security-definer function used by the signup flow when email
-- confirmation is enabled and no session is available yet.
-- Verifies the profile was created (handle_new_user trigger is
-- synchronous) then atomically marks the token claimed.
CREATE OR REPLACE FUNCTION public.claim_invite_token(p_token text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN false;
  END IF;

  UPDATE public.invite_tokens
  SET claimed_by = p_user_id, claimed_at = now()
  WHERE token = p_token
    AND claimed_by IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_invite_token(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_invite_token(text, uuid) TO anon, authenticated;
