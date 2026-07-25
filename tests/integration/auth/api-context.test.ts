// Integration coverage for `requireApiKey` (src/lib/auth/api-context.ts)
// against wacrm-staging — the sole authentication path for every
// `/api/v1/*` route (current-state.md, ficha 2.13). The unit suite
// (src/lib/auth/api-context.test.ts) mocks `findActiveKeyByHash`
// entirely; this file exercises the real chain — bearer extraction ->
// SHA-256 hash -> a real `api_keys` row -> rate-limit -> scope check —
// against real rows in staging.
//
// `supabaseAdmin` (src/lib/flows/admin-client.ts) reads
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — NOT the
// staging-only SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_ROLE_KEY that
// guard-staging.ts validates. Left alone, `requireApiKey`'s own DB
// calls would go through an *unguarded* client that, in this repo's
// .env.local, points at a different Supabase project entirely. We
// mock the module so every call it makes is funneled through
// `testSupabase()` instead — same guarded client the rest of this
// suite uses, regardless of what those two unguarded vars hold in the
// runner's environment. See the finding logged for this gap.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/flows/admin-client', async () => {
  const { testSupabase } = await import('../setup/client');
  return { supabaseAdmin: () => testSupabase() };
});

import { API_KEY_PREFIX } from '@/lib/api-keys/keys';
import { ApiError } from '@/lib/api/v1/respond';
import { __resetRateLimitForTests, RATE_LIMITS } from '@/lib/rate-limit';

import {
  cleanupTestAccount,
  createTestAccount,
  type TestAccount,
} from '../setup/account-fixture';
import { createTestApiKey } from '../setup/api-key-fixture';
import { testSupabase } from '../setup/client';

// Import AFTER the mock is registered, same convention as the unit test.
const { requireApiKey } = await import('@/lib/auth/api-context');

function reqWith(authHeader?: string): Request {
  return new Request('https://crm.example.com/api/v1/me', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

async function expectApiError(p: Promise<unknown>, code: string, status: number) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: unknown) => {
    const err = e as ApiError;
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
}

/** touchLastUsed is fire-and-forget — poll briefly for it to land. */
async function pollForLastUsedAt(keyId: string): Promise<string | null> {
  for (let i = 0; i < 15; i++) {
    const { data } = await testSupabase()
      .from('api_keys')
      .select('last_used_at')
      .eq('id', keyId)
      .single();
    if (data?.last_used_at) return data.last_used_at as string;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

describe('requireApiKey (026_api_keys.sql) against wacrm-staging', () => {
  let account: TestAccount;

  beforeAll(async () => {
    account = await createTestAccount({ namePrefix: 'apikey' });
  });

  afterAll(async () => {
    // api_keys rows created below cascade-delete with the account
    // (026_api_keys.sql: account_id ... ON DELETE CASCADE).
    await cleanupTestAccount(account);
  });

  afterEach(() => {
    __resetRateLimitForTests();
  });

  it('resolves a valid, in-scope key to the account context and bumps last_used_at', async () => {
    const key = await createTestApiKey({
      accountId: account.accountId,
      createdByUserId: account.owner.id,
      scopes: ['messages:send', 'contacts:read'],
    });

    const ctx = await requireApiKey(reqWith(`Bearer ${key.plaintext}`), 'messages:send');

    expect(ctx.authType).toBe('api_key');
    expect(ctx.accountId).toBe(account.accountId);
    expect(ctx.keyId).toBe(key.id);
    expect(ctx.scopes).toEqual(['messages:send', 'contacts:read']);
    expect(ctx.createdBy).toBe(account.owner.id);

    expect(await pollForLastUsedAt(key.id)).not.toBeNull();
  });

  it('accepts a bare key without the "Bearer " prefix', async () => {
    const key = await createTestApiKey({ accountId: account.accountId });

    const ctx = await requireApiKey(reqWith(key.plaintext));

    expect(ctx.accountId).toBe(account.accountId);
  });

  it('401s on a malformed bearer token (never reaches the DB)', async () => {
    await expectApiError(
      requireApiKey(reqWith('Bearer some-invite-token')),
      'unauthorized',
      401,
    );
  });

  it('401s on a well-formed key with no matching row', async () => {
    const neverIssued = `${API_KEY_PREFIX}${'a'.repeat(43)}`;
    await expectApiError(requireApiKey(reqWith(`Bearer ${neverIssued}`)), 'unauthorized', 401);
  });

  it('401s on a revoked key', async () => {
    const key = await createTestApiKey({
      accountId: account.accountId,
      revokedAt: new Date(),
    });

    await expectApiError(requireApiKey(reqWith(`Bearer ${key.plaintext}`)), 'unauthorized', 401);
  });

  it('401s on an expired key', async () => {
    const key = await createTestApiKey({
      accountId: account.accountId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expectApiError(requireApiKey(reqWith(`Bearer ${key.plaintext}`)), 'unauthorized', 401);
  });

  it('403s when the key lacks the required scope', async () => {
    const key = await createTestApiKey({
      accountId: account.accountId,
      scopes: ['contacts:read'],
    });

    await expectApiError(
      requireApiKey(reqWith(`Bearer ${key.plaintext}`), 'messages:send'),
      'forbidden',
      403,
    );
  });

  it(
    '429s once the per-key rate-limit budget is exhausted',
    async () => {
      const key = await createTestApiKey({ accountId: account.accountId });

      for (let i = 0; i < RATE_LIMITS.publicApi.limit; i++) {
        await requireApiKey(reqWith(`Bearer ${key.plaintext}`));
      }

      await expectApiError(requireApiKey(reqWith(`Bearer ${key.plaintext}`)), 'rate_limited', 429);
    },
    60_000,
  );
});
