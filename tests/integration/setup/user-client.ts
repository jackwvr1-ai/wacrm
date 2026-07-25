// Builds a Supabase client that acts AS a given test user, so RPC
// calls see a real `auth.uid()` instead of the service-role's NULL.
//
// There's no anon/publishable key wired into the integration env (see
// .env.test.example) — service-role-only was Paso 1's minimal surface.
// Rather than widen that surface, we mint a real user session purely
// from the admin API already in use elsewhere in this suite:
//
//   1. `auth.admin.generateLink` (service role) issues a one-time
//      magiclink `hashed_token` for the user's email — no password
//      needed, no email actually sent.
//   2. `auth.verifyOtp({ token_hash, type: 'magiclink' })` redeems it
//      for a real session (access_token with `sub` = the user's id,
//      `role: authenticated`), exactly like a browser completing a
//      magic-link login.
//   3. A fresh client is created with that access token as the
//      Authorization header, so PostgREST/RPC evaluate `auth.uid()`
//      as this user — RLS and the SECURITY DEFINER functions' own
//      `auth.uid()` checks both see it.
//
// Sessions are memoized per user id — GoTrue rate-limits the
// generateLink/verifyOtp endpoints, and the same test user is often
// asked for a client repeatedly across a spec file (once per RPC call
// against them), so minting a fresh session every time exhausts the
// limit well before a suite finishes.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { testSupabase } from './client';
import type { TestUser } from './account-fixture';

const clientCache = new Map<string, Promise<SupabaseClient>>();

export function getUserClient(user: TestUser): Promise<SupabaseClient> {
  let cached = clientCache.get(user.id);
  if (!cached) {
    cached = buildUserClient(user);
    clientCache.set(user.id, cached);
  }
  return cached;
}

async function buildUserClient(user: TestUser): Promise<SupabaseClient> {
  const admin = testSupabase();
  const url = process.env.SUPABASE_TEST_URL!;
  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!;

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (linkError || !linkData) {
    throw new Error(
      `[integration tests] failed to generate a login link for ${user.email}: ${linkError?.message}`
    );
  }

  const anonymousLike = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyError } = await anonymousLike.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyError || !verified.session) {
    throw new Error(
      `[integration tests] failed to redeem login link for ${user.email}: ${verifyError?.message}`
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
  });
}
