// Integration coverage for supabase/migrations/018_account_member_rpcs.sql
// against wacrm-staging. Each RPC is exercised as different real users
// (via tests/integration/setup/user-client.ts) so `auth.uid()` inside
// the SECURITY DEFINER functions sees the actual caller, not the
// service-role bypass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupTestAccount,
  createTestAccount,
  type TestAccount,
  type TestUser,
} from '../setup/account-fixture';
import { testSupabase } from '../setup/client';
import { getUserClient } from '../setup/user-client';

describe('account member RPCs (018_account_member_rpcs.sql)', () => {
  let account: TestAccount;
  let outsiderAccount: TestAccount;
  let adminUser: TestUser;
  let agentA: TestUser;
  let agentB: TestUser;

  beforeAll(async () => {
    account = await createTestAccount({ agentCount: 3, namePrefix: 'members' });
    outsiderAccount = await createTestAccount({ namePrefix: 'members-outsider' });
    [adminUser, agentA, agentB] = account.agents;

    // Promote directly via service role — set_member_role is the
    // function under test, so its own behavior can't be used to set
    // up its own preconditions.
    const { error } = await testSupabase()
      .from('profiles')
      .update({ account_role: 'admin' })
      .eq('user_id', adminUser.id);
    if (error) throw error;
  });

  afterAll(async () => {
    await cleanupTestAccount(account);
    await cleanupTestAccount(outsiderAccount);
  });

  async function roleOf(userId: string): Promise<string> {
    const { data, error } = await testSupabase()
      .from('profiles')
      .select('account_role')
      .eq('user_id', userId)
      .single();
    if (error || !data) throw error ?? new Error('profile not found');
    return data.account_role as string;
  }

  describe('set_member_role', () => {
    it('lets the owner change a plain agent role', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('set_member_role', {
        p_user_id: agentA.id,
        p_new_role: 'viewer',
      });

      expect(error).toBeNull();
      expect(await roleOf(agentA.id)).toBe('viewer');

      await testSupabase()
        .from('profiles')
        .update({ account_role: 'agent' })
        .eq('user_id', agentA.id);
    });

    it('lets an admin change another agent role', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('set_member_role', {
        p_user_id: agentB.id,
        p_new_role: 'viewer',
      });

      expect(error).toBeNull();
      expect(await roleOf(agentB.id)).toBe('viewer');

      await testSupabase()
        .from('profiles')
        .update({ account_role: 'agent' })
        .eq('user_id', agentB.id);
    });

    it('forbids a plain agent from calling it', async () => {
      const agent = await getUserClient(agentA);

      const { error } = await agent.rpc('set_member_role', {
        p_user_id: agentB.id,
        p_new_role: 'admin',
      });

      expect(error?.code).toBe('42501');
    });

    it('forbids changing your own role', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('set_member_role', {
        p_user_id: account.owner.id,
        p_new_role: 'admin',
      });

      expect(error?.code).toBe('22023');
    });

    it('forbids targeting a user outside the caller account', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('set_member_role', {
        p_user_id: outsiderAccount.owner.id,
        p_new_role: 'admin',
      });

      expect(error?.code).toBe('42501');
    });

    it('refuses to promote a member to owner', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('set_member_role', {
        p_user_id: agentA.id,
        p_new_role: 'owner',
      });

      expect(error?.code).toBe('22023');
    });

    it('refuses to demote the owner via this endpoint', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('set_member_role', {
        p_user_id: account.owner.id,
        p_new_role: 'admin',
      });

      expect(error?.code).toBe('22023');
    });
  });

  describe('remove_account_member', () => {
    it('lets an admin remove a plain agent, who lands on a fresh personal account', async () => {
      const admin = await getUserClient(adminUser);

      const { data: newAccountId, error } = await admin.rpc('remove_account_member', {
        p_user_id: agentA.id,
      });

      expect(error).toBeNull();
      expect(newAccountId).toBeTruthy();
      expect(newAccountId).not.toBe(account.accountId);

      const { data: profile } = await testSupabase()
        .from('profiles')
        .select('account_id, account_role')
        .eq('user_id', agentA.id)
        .single();
      expect(profile?.account_id).toBe(newAccountId);
      expect(profile?.account_role).toBe('owner');

      // agentA is no longer part of `account` — clean up the account
      // this call spun up for them and hand teardown of their auth
      // user directly here instead of via cleanupTestAccount(account).
      await testSupabase().from('accounts').delete().eq('id', newAccountId as string);
      await testSupabase().auth.admin.deleteUser(agentA.id);
      account.agents = account.agents.filter((a) => a.id !== agentA.id);
    });

    it('forbids a plain agent from calling it', async () => {
      const agent = await getUserClient(agentB);

      const { error } = await agent.rpc('remove_account_member', {
        p_user_id: adminUser.id,
      });

      expect(error?.code).toBe('42501');
    });

    it('forbids removing the owner', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('remove_account_member', {
        p_user_id: account.owner.id,
      });

      expect(error?.code).toBe('22023');
    });

    it('forbids removing yourself', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('remove_account_member', {
        p_user_id: adminUser.id,
      });

      expect(error?.code).toBe('22023');
    });

    it('forbids targeting a user outside the caller account', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('remove_account_member', {
        p_user_id: outsiderAccount.owner.id,
      });

      expect(error?.code).toBe('42501');
    });
  });

  describe('transfer_account_ownership', () => {
    it('forbids a non-owner from calling it', async () => {
      const admin = await getUserClient(adminUser);

      const { error } = await admin.rpc('transfer_account_ownership', {
        p_new_owner_user_id: agentB.id,
      });

      expect(error?.code).toBe('42501');
    });

    it('forbids transferring to yourself', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('transfer_account_ownership', {
        p_new_owner_user_id: account.owner.id,
      });

      expect(error?.code).toBe('22023');
    });

    it('forbids targeting a user outside the caller account', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('transfer_account_ownership', {
        p_new_owner_user_id: outsiderAccount.owner.id,
      });

      expect(error?.code).toBe('42501');
    });

    it('moves ownership atomically and demotes the old owner to admin', async () => {
      const owner = await getUserClient(account.owner);

      const { error } = await owner.rpc('transfer_account_ownership', {
        p_new_owner_user_id: adminUser.id,
      });

      expect(error).toBeNull();
      expect(await roleOf(adminUser.id)).toBe('owner');
      expect(await roleOf(account.owner.id)).toBe('admin');

      const { data: acc } = await testSupabase()
        .from('accounts')
        .select('owner_user_id')
        .eq('id', account.accountId)
        .single();
      expect(acc?.owner_user_id).toBe(adminUser.id);
    });
  });
});
