// Fixture for `account_invitations` rows, mirroring the insert the
// real route handler does (src/app/api/account/invitations/route.ts)
// but through the service-role client — RLS on this table only lets
// admin+ members of the account read/write it (017_account_sharing.sql),
// which the tests' service-role client bypasses on purpose.
import { generateInviteToken, inviteExpiresAt } from '@/lib/auth/invitations';

import { testSupabase } from './client';

export interface TestInvitation {
  id: string;
  token: string;
  hash: string;
}

export async function createTestInvitation(opts: {
  accountId: string;
  createdByUserId: string;
  role?: 'admin' | 'agent' | 'viewer';
  expiresAt?: Date;
  accepted?: boolean;
}): Promise<TestInvitation> {
  const supabase = testSupabase();
  const { token, hash } = generateInviteToken();

  const { data, error } = await supabase
    .from('account_invitations')
    .insert({
      account_id: opts.accountId,
      token_hash: hash,
      role: opts.role ?? 'agent',
      created_by_user_id: opts.createdByUserId,
      expires_at: (opts.expiresAt ?? inviteExpiresAt(7)).toISOString(),
      accepted_at: opts.accepted ? new Date().toISOString() : null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `[integration tests] failed to create test invitation for account ${opts.accountId}: ${error?.message}`
    );
  }

  return { id: data.id as string, token, hash };
}
