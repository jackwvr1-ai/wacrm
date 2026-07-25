// Fixture for `api_keys` rows, inserted directly via the service-role
// client (mirrors invitation-fixture.ts) so tests can put a key into
// any state `requireApiKey` (src/lib/auth/api-context.ts) must handle —
// active, revoked, expired, scoped — without going through the
// (RLS-gated, admin-only) creation route.
import { generateApiKey } from '@/lib/api-keys/keys';
import type { ApiScope } from '@/lib/api-keys/scopes';

import { testSupabase } from './client';

export interface TestApiKey {
  id: string;
  /** Plaintext bearer token — only ever returned here, never re-read. */
  plaintext: string;
}

export async function createTestApiKey(opts: {
  accountId: string;
  createdByUserId?: string | null;
  scopes?: ApiScope[];
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}): Promise<TestApiKey> {
  const supabase = testSupabase();
  const { plaintext, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      account_id: opts.accountId,
      created_by: opts.createdByUserId ?? null,
      name: 'Integration test key',
      key_prefix: prefix,
      key_hash: hash,
      scopes: opts.scopes ?? [],
      expires_at: opts.expiresAt ? opts.expiresAt.toISOString() : null,
      revoked_at: opts.revokedAt ? opts.revokedAt.toISOString() : null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `[integration tests] failed to create test api key for account ${opts.accountId}: ${error?.message}`
    );
  }

  return { id: data.id as string, plaintext };
}
