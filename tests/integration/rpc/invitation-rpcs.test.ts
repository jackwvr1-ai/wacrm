// Integration coverage for supabase/migrations/019_invitation_rpcs.sql
// against wacrm-staging.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupTestAccount,
  createTestAccount,
  type TestAccount,
} from '../setup/account-fixture';
import { testSupabase } from '../setup/client';
import { createTestInvitation } from '../setup/invitation-fixture';
import { getUserClient } from '../setup/user-client';

describe('invitation RPCs (019_invitation_rpcs.sql)', () => {
  let accountsToCleanup: TestAccount[];

  beforeEach(() => {
    accountsToCleanup = [];
  });

  afterEach(async () => {
    for (const acc of accountsToCleanup) {
      await cleanupTestAccount(acc);
    }
  });

  function track(acc: TestAccount): TestAccount {
    accountsToCleanup.push(acc);
    return acc;
  }

  describe('peek_invitation', () => {
    // peek is anonymous in production (no caller identity checked),
    // but we don't have an anon key wired into the integration env —
    // any authenticated session works identically for exercising it.
    let caller: Awaited<ReturnType<typeof getUserClient>>;
    let callerAccount: TestAccount;

    beforeAll(async () => {
      callerAccount = await createTestAccount({ namePrefix: 'peek-caller' });
      caller = await getUserClient(callerAccount.owner);
    });

    afterAll(async () => {
      await cleanupTestAccount(callerAccount);
    });

    it('returns account name, role, and expiry for a pending invite', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'peek-inviter' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
        role: 'admin',
      });

      const { data, error } = await caller.rpc('peek_invitation', {
        p_token_hash: invite.hash,
      });

      expect(error).toBeNull();
      expect(data.ok).toBe(true);
      expect(data.role).toBe('admin');
      expect(typeof data.account_name).toBe('string');
      expect(data.expires_at).toBeTruthy();
    });

    it('reports not_found for an unknown token hash', async () => {
      const { data, error } = await caller.rpc('peek_invitation', {
        p_token_hash: 'a'.repeat(64),
      });

      expect(error).toBeNull();
      expect(data).toEqual({ ok: false, reason: 'not_found' });
    });

    it('reports expired for a past-dated invite', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'peek-expired' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
        expiresAt: new Date(Date.now() - 60_000),
      });

      const { data } = await caller.rpc('peek_invitation', {
        p_token_hash: invite.hash,
      });

      expect(data).toEqual({ ok: false, reason: 'expired' });
    });

    it('reports used for an already-accepted invite', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'peek-used' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
        accepted: true,
      });

      const { data } = await caller.rpc('peek_invitation', {
        p_token_hash: invite.hash,
      });

      expect(data).toEqual({ ok: false, reason: 'used' });
    });
  });

  describe('redeem_invitation', () => {
    it('moves a fresh sole-owner caller into the inviter account and deletes the old personal account', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'redeem-inviter' }));
      const invitee = track(await createTestAccount({ namePrefix: 'redeem-invitee' }));
      const oldAccountId = invitee.accountId;
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
        role: 'agent',
      });

      const inviteeClient = await getUserClient(invitee.owner);
      const { data: joinedAccountId, error } = await inviteeClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });

      expect(error).toBeNull();
      expect(joinedAccountId).toBe(inviter.accountId);

      const { data: profile } = await testSupabase()
        .from('profiles')
        .select('account_id, account_role')
        .eq('user_id', invitee.owner.id)
        .single();
      expect(profile?.account_id).toBe(inviter.accountId);
      expect(profile?.account_role).toBe('agent');

      const { data: invRow } = await testSupabase()
        .from('account_invitations')
        .select('accepted_at, accepted_by_user_id')
        .eq('id', invite.id)
        .single();
      expect(invRow?.accepted_at).toBeTruthy();
      expect(invRow?.accepted_by_user_id).toBe(invitee.owner.id);

      const { data: oldAccount } = await testSupabase()
        .from('accounts')
        .select('id')
        .eq('id', oldAccountId)
        .maybeSingle();
      expect(oldAccount).toBeNull();
    });

    it('rejects an unknown token', async () => {
      const invitee = track(await createTestAccount({ namePrefix: 'redeem-unknown' }));
      const inviteeClient = await getUserClient(invitee.owner);

      const { error } = await inviteeClient.rpc('redeem_invitation', {
        p_token_hash: 'a'.repeat(64),
      });

      expect(error?.code).toBe('22023');
    });

    it('rejects an expired invite', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'redeem-expired-inviter' }));
      const invitee = track(await createTestAccount({ namePrefix: 'redeem-expired-invitee' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
        expiresAt: new Date(Date.now() - 60_000),
      });
      const inviteeClient = await getUserClient(invitee.owner);

      const { error } = await inviteeClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });

      expect(error?.code).toBe('22023');
    });

    it('rejects a second redemption of the same invite', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'redeem-twice-inviter' }));
      const firstInvitee = track(await createTestAccount({ namePrefix: 'redeem-twice-first' }));
      const secondInvitee = track(await createTestAccount({ namePrefix: 'redeem-twice-second' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
      });

      const firstClient = await getUserClient(firstInvitee.owner);
      const { error: firstError } = await firstClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });
      expect(firstError).toBeNull();

      const secondClient = await getUserClient(secondInvitee.owner);
      const { error: secondError } = await secondClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });
      expect(secondError?.code).toBe('22023');
    });

    it('rejects a caller who already belongs to a shared account', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'redeem-shared-inviter' }));
      const otherShared = track(
        await createTestAccount({ agentCount: 1, namePrefix: 'redeem-shared-other' })
      );
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
      });

      // otherShared.agents[0] belongs to otherShared's account but is
      // NOT its owner — exactly the "already in a shared account" case.
      const memberClient = await getUserClient(otherShared.agents[0]);
      const { error } = await memberClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });

      expect(error?.code).toBe('23505');
    });

    it('rejects a caller whose personal account already has data', async () => {
      const inviter = track(await createTestAccount({ namePrefix: 'redeem-hasdata-inviter' }));
      const invitee = track(await createTestAccount({ namePrefix: 'redeem-hasdata-invitee' }));
      const invite = await createTestInvitation({
        accountId: inviter.accountId,
        createdByUserId: inviter.owner.id,
      });

      const { error: contactError } = await testSupabase().from('contacts').insert({
        account_id: invitee.accountId,
        user_id: invitee.owner.id,
        phone: '+10000000000',
      });
      expect(contactError).toBeNull();

      const inviteeClient = await getUserClient(invitee.owner);
      const { error } = await inviteeClient.rpc('redeem_invitation', {
        p_token_hash: invite.hash,
      });

      expect(error?.code).toBe('23505');
    });
  });
});
