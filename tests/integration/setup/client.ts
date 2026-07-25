// Service-role Supabase client for integration tests. Talks to
// wacrm-staging only — see guard-staging.ts, which this re-checks
// before ever creating a client, independent of whether the caller
// went through Vitest's globalSetup.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { assertStagingUrl } from './guard-staging';
import './load-env';

let _client: SupabaseClient | null = null;

/** Lazy, memoized — every test file shares one connection. */
export function testSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_TEST_URL;
  assertStagingUrl(url);

  const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      '[integration tests] SUPABASE_TEST_SERVICE_ROLE_KEY is not set. See .env.test.example.'
    );
  }

  _client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}
