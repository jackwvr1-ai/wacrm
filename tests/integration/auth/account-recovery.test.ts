// Integration coverage for the orphaned-user recovery path in
// getCurrentAccount (src/lib/auth/account.ts) against wacrm-staging.
//
// Background (_fase3/INSTRUCCIONES-fix-huerfano.md): handle_new_user
// (017_account_sharing.sql:659-689) wraps its account+profile bootstrap
// in a BEGIN...EXCEPTION WHEN OTHERS block. If the INSERT into
// `profiles` fails, PL/pgSQL's implicit savepoint on that block also
// rolls back the preceding INSERT into `accounts` — so a failure there
// leaves the user in `auth.users` with ZERO rows in `accounts` or
// `profiles`, not a dangling reference. We reproduce that exact state
// the same way the account-fixture teardown does: let the trigger fire
// normally, then delete the `accounts` row directly. Its FK
// (`profiles.account_id ... ON DELETE CASCADE`, 017_account_sharing.sql:92)
// cascades the profile away with it.
//
// `getCurrentAccount` is the single chokepoint every API route and
// server component calls before touching account-scoped data — so it's
// where recovery is triggered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

let currentClient: SupabaseClient;
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => currentClient,
}));

import { createTestAccount, type TestAccount } from '../setup/account-fixture';
import { testSupabase } from '../setup/client';
import { getUserClient } from '../setup/user-client';

// Import AFTER the mock is registered, same convention as
// tests/integration/auth/api-context.test.ts.
const { getCurrentAccount } = await import('@/lib/auth/account');

describe('getCurrentAccount — orphaned-user recovery', () => {
  let account: TestAccount;

  beforeEach(async () => {
    account = await createTestAccount({ namePrefix: 'orphan' });

    // Simulate the handle_new_user failure: delete the account the
    // trigger created for the owner. This cascades away their profile
    // too, leaving them authenticated with no profile and no account —
    // the exact huerfano state.
    const { error } = await testSupabase()
      .from('accounts')
      .delete()
      .eq('id', account.accountId);
    expect(error).toBeNull();

    currentClient = await getUserClient(account.owner);
  });

  afterEach(async () => {
    // Recovery (once implemented) creates a NEW account for the owner,
    // under a different id than the one the fixture tracked and we
    // just deleted above — clean up by owner_user_id instead of the
    // fixture's cleanupTestAccount, which only knows the stale id.
    const { error: deleteAccountError } = await testSupabase()
      .from('accounts')
      .delete()
      .eq('owner_user_id', account.owner.id);
    if (deleteAccountError) throw deleteAccountError;

    const { error: deleteUserError } = await testSupabase().auth.admin.deleteUser(
      account.owner.id
    );
    if (deleteUserError) throw deleteUserError;
  });

  it('recovers a fresh personal account so the app works again, instead of leaving the user Forbidden', async () => {
    const ctx = await getCurrentAccount();

    expect(ctx.userId).toBe(account.owner.id);
    expect(ctx.role).toBe('owner');
    // A fresh account, not the one we deleted above.
    expect(ctx.accountId).not.toBe(account.accountId);
    // Same default-naming rule as handle_new_user:
    // COALESCE(NULLIF(full_name,''), email, 'My account') — createSeedUser
    // seeds full_name as "Integration test — <label>".
    expect(ctx.account.name).toContain('orphan-owner');

    const { data: profile } = await testSupabase()
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', account.owner.id)
      .single();
    expect(profile?.account_id).toBe(ctx.accountId);
    expect(profile?.account_role).toBe('owner');
  });
});
