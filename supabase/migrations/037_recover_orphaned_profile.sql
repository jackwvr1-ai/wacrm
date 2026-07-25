-- ============================================================
-- 037_recover_orphaned_profile.sql — self-service recovery for
-- users left without a profile/account by handle_new_user.
--
-- Problem (see _fase3/INSTRUCCIONES-fix-huerfano.md): handle_new_user
-- (017_account_sharing.sql:659-689) wraps its account+profile bootstrap
-- in a BEGIN...EXCEPTION WHEN OTHERS block. PL/pgSQL implicitly wraps
-- that block in a savepoint, so if the INSERT into `profiles` fails,
-- the preceding INSERT into `accounts` is rolled back too — the user
-- ends up in `auth.users` with NO row in `accounts` or `profiles` at
-- all. They can log in, but every route via getCurrentAccount()
-- (src/lib/auth/account.ts) throws ForbiddenError.
--
-- This does NOT change handle_new_user or its silent-catch behavior —
-- that's an explicit, already-made design decision (see instructions).
-- Instead, getCurrentAccount calls this RPC exactly once, only when it
-- finds no profile row at all for the caller, and retries.
--
-- recover_orphaned_profile() replicates handle_new_user's bootstrap
-- (same default name, same 'owner' role) for the CURRENT caller
-- (auth.uid()), atomically:
--   - pg_advisory_xact_lock serializes concurrent calls for the same
--     user (e.g. two tabs racing this on load), released at
--     transaction end.
--   - Idempotent: if a profile already exists by the time the lock is
--     acquired (a concurrent call won the race, or the caller was
--     never actually orphaned), returns its account_id without
--     creating a duplicate.
--
-- Idempotent to (re)apply — safe to run multiple times.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recover_orphaned_profile()
RETURNS UUID  -- the caller's account_id (existing or freshly created)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_email TEXT;
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_caller_id::text));

  SELECT account_id INTO v_account_id
  FROM public.profiles
  WHERE user_id = v_caller_id;

  IF FOUND THEN
    RETURN v_account_id;
  END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', '')
  INTO v_email, v_full_name
  FROM auth.users
  WHERE id = v_caller_id;

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), v_email, 'My account'), v_caller_id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (v_caller_id, v_full_name, v_email, v_account_id, 'owner');

  RETURN v_account_id;
END;
$$;

ALTER FUNCTION public.recover_orphaned_profile() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recover_orphaned_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_orphaned_profile() TO authenticated;
