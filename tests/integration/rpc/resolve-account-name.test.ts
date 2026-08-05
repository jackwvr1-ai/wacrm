// Integration coverage for resolve_account_name (040_...sql) against
// wacrm-staging. Pure SQL function, no auth.uid() involved and no rows
// touched, so the service-role client is enough — no fixture account
// needed.
//
// Fase 3.4c reverts 039's fallback chain: the account name must no
// longer fall back to full_name or email, only to business_name (when
// present) or the provisional 'My account'.
import { describe, expect, it } from 'vitest';

import { testSupabase } from '../setup/client';

describe('resolve_account_name (040_signup_minimo.sql)', () => {
  it('sin business_name, ni full_name ni email cuentan — cae en el fallback provisional', async () => {
    const { data, error } = await testSupabase().rpc('resolve_account_name', {
      p_raw_user_meta_data: { full_name: 'Jack Rivera' },
      p_email: 'test@test.com',
    });
    expect(error).toBeNull();
    expect(data).toBe('My account');
  });

  it('sin ningún dato — también cae en el fallback provisional', async () => {
    const { data, error } = await testSupabase().rpc('resolve_account_name', {
      p_raw_user_meta_data: {},
      p_email: 'test@test.com',
    });
    expect(error).toBeNull();
    expect(data).toBe('My account');
  });

  it('con business_name — sigue ganando, sin cambios de 039', async () => {
    const { data, error } = await testSupabase().rpc('resolve_account_name', {
      p_raw_user_meta_data: { business_name: 'Acme' },
      p_email: 'test@test.com',
    });
    expect(error).toBeNull();
    expect(data).toBe('Acme');
  });
});
