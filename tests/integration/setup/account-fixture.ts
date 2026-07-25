// Setup/teardown for integration tests: create a throwaway account
// with an owner (and optionally agents) against wacrm-staging, then
// tear it down. Mirrors the pattern proven out by
// supabase/seed/staging-036-validation.sql, but through supabase-js
// instead of raw SQL:
//
//   - `auth.admin.createUser` fires the same `handle_new_user`
//     trigger (017_account_sharing.sql) as a real sign-up, which
//     gives the new user their own personal account + an 'owner'
//     profile. For the account's owner, that personal account *is*
//     the test account — no need to create a second one.
//   - Each additional member is created the same way, then reassigned
//     onto the owner's account (account_id + account_role) and their
//     own now-empty personal account is deleted — same two-step
//     "UPDATE profiles, then DELETE the orphaned account" the seed
//     script uses for user_2/user_4.
//
// Cleanup deletes the account (accounts -> profiles/contacts/
// conversations cascade — 017_account_sharing.sql) and then every
// auth user explicitly, since deleting a profile's account doesn't
// cascade to auth.users.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { testSupabase } from './client';

export interface TestUser {
  id: string;
  email: string;
}

export interface TestAccount {
  accountId: string;
  owner: TestUser;
  agents: TestUser[];
}

export async function createTestAccount(
  opts: { agentCount?: number; namePrefix?: string } = {}
): Promise<TestAccount> {
  const supabase = testSupabase();
  const { agentCount = 0, namePrefix = 'it' } = opts;

  const owner = await createSeedUser(supabase, `${namePrefix}-owner`);
  const accountId = await getPersonalAccountId(supabase, owner);

  const agents: TestUser[] = [];
  for (let i = 0; i < agentCount; i++) {
    const agent = await createSeedUser(supabase, `${namePrefix}-agent-${i}`);
    await reassignToAccount(supabase, agent, accountId);
    agents.push(agent);
  }

  return { accountId, owner, agents };
}

export async function cleanupTestAccount(account: TestAccount): Promise<void> {
  const supabase = testSupabase();

  const { error: deleteAccountError } = await supabase
    .from('accounts')
    .delete()
    .eq('id', account.accountId);
  if (deleteAccountError) {
    throw new Error(
      `[integration tests] failed to delete test account ${account.accountId}: ${deleteAccountError.message}`
    );
  }

  for (const user of [account.owner, ...account.agents]) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      throw new Error(
        `[integration tests] failed to delete auth user ${user.email}: ${error.message}`
      );
    }
  }
}

async function createSeedUser(
  supabase: SupabaseClient,
  label: string
): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@seed.wacrm.test`;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: `Integration test — ${label}` },
  });
  if (error || !data.user) {
    throw new Error(
      `[integration tests] failed to create auth user ${email}: ${error?.message}`
    );
  }
  return { id: data.user.id, email };
}

async function getPersonalAccountId(
  supabase: SupabaseClient,
  user: TestUser
): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  if (error || !data) {
    throw new Error(
      `[integration tests] handle_new_user did not create a profile for ${user.email}: ${error?.message}`
    );
  }
  return data.account_id as string;
}

async function reassignToAccount(
  supabase: SupabaseClient,
  user: TestUser,
  accountId: string
): Promise<void> {
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ account_id: accountId, account_role: 'agent' })
    .eq('user_id', user.id);
  if (updateError) {
    throw new Error(
      `[integration tests] failed to reassign ${user.email} onto ${accountId}: ${updateError.message}`
    );
  }

  // Drops the personal account handle_new_user created for this user
  // now that it's empty — idx_accounts_one_per_owner (017) would
  // otherwise block reusing this user as an owner in a later test.
  const { error: deleteError } = await supabase
    .from('accounts')
    .delete()
    .eq('owner_user_id', user.id);
  if (deleteError) {
    throw new Error(
      `[integration tests] failed to drop ${user.email}'s personal account: ${deleteError.message}`
    );
  }
}
