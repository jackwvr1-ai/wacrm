// Integration coverage for the `accounts` business-profile columns
// added by 038_account_business_fields.sql, against wacrm-staging.
//
// This complements the mocked unit suite at
// src/app/api/account/route.test.ts (which covers the route's own
// app-level validation) by exercising what only a real Postgres
// connection can show:
//   - the three format CHECK constraints (country_code, language_code,
//     business_email) actually reject malformed values;
//   - `timezone` — deliberately uncheckable in a CHECK constraint per
//     038's own header comment — is NOT rejected by the DB, which is
//     exactly why the route validates it in application code instead;
//   - accounts_update (017_account_sharing.sql) still gates writes to
//     admin+ now that more columns are writable through it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupTestAccount,
  createTestAccount,
  type TestAccount,
} from '../setup/account-fixture';
import { getUserClient } from '../setup/user-client';

describe('accounts business profile fields (038_account_business_fields.sql)', () => {
  let account: TestAccount;

  beforeAll(async () => {
    account = await createTestAccount({ agentCount: 1, namePrefix: 'bizfields' });
  });

  afterAll(async () => {
    await cleanupTestAccount(account);
  });

  it('an owner/admin can persist all 8 business fields through real RLS', async () => {
    const owner = await getUserClient(account.owner);

    const { data, error } = await owner
      .from('accounts')
      .update({
        business_type: 'retail',
        country_code: 'AR',
        timezone: 'America/Argentina/Salta',
        language_code: 'es-AR',
        logo_url: 'https://cdn.example.com/logo.png',
        business_email: 'hola@acme.com',
        business_phone: '+54 9 11 5555-5555',
        address: 'Av. Siempre Viva 742',
      })
      .eq('id', account.accountId)
      .select(
        'business_type, country_code, timezone, language_code, logo_url, business_email, business_phone, address',
      )
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({
      business_type: 'retail',
      country_code: 'AR',
      timezone: 'America/Argentina/Salta',
      language_code: 'es-AR',
      logo_url: 'https://cdn.example.com/logo.png',
      business_email: 'hola@acme.com',
      business_phone: '+54 9 11 5555-5555',
      address: 'Av. Siempre Viva 742',
    });
  });

  it('CHECK accounts_country_code_format rejects a malformed country_code', async () => {
    const owner = await getUserClient(account.owner);

    // Must stay 2 characters — country_code is CHAR(2), so anything
    // longer trips a "value too long" error before ever reaching the
    // format CHECK. Lowercase is the right length but the wrong case.
    const { error } = await owner
      .from('accounts')
      .update({ country_code: 'ar' })
      .eq('id', account.accountId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/accounts_country_code_format/);
  });

  it('CHECK accounts_language_code_format rejects a malformed language_code', async () => {
    const owner = await getUserClient(account.owner);

    const { error } = await owner
      .from('accounts')
      .update({ language_code: 'spanish' })
      .eq('id', account.accountId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/accounts_language_code_format/);
  });

  it('CHECK accounts_business_email_format rejects a malformed business_email', async () => {
    const owner = await getUserClient(account.owner);

    const { error } = await owner
      .from('accounts')
      .update({ business_email: 'not-an-email' })
      .eq('id', account.accountId);

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/accounts_business_email_format/);
  });

  it('the DB accepts any timezone string — no CHECK exists, unlike the other three columns', async () => {
    const owner = await getUserClient(account.owner);

    const { data, error } = await owner
      .from('accounts')
      .update({ timezone: 'Not/A_Real_Zone' })
      .eq('id', account.accountId)
      .select('timezone')
      .single();

    expect(error).toBeNull();
    expect(data!.timezone).toBe('Not/A_Real_Zone');

    // Leave the row valid for the tests below.
    await owner
      .from('accounts')
      .update({ timezone: 'America/Argentina/Salta' })
      .eq('id', account.accountId);
  });

  it('every business field accepts NULL — all NULLABLE, no DEFAULT', async () => {
    const owner = await getUserClient(account.owner);

    const { data, error } = await owner
      .from('accounts')
      .update({
        business_type: null,
        country_code: null,
        timezone: null,
        language_code: null,
        logo_url: null,
        business_email: null,
        business_phone: null,
        address: null,
      })
      .eq('id', account.accountId)
      .select(
        'business_type, country_code, timezone, language_code, logo_url, business_email, business_phone, address',
      )
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({
      business_type: null,
      country_code: null,
      timezone: null,
      language_code: null,
      logo_url: null,
      business_email: null,
      business_phone: null,
      address: null,
    });
  });

  it('accounts_update (017) still blocks a non-admin agent from writing business fields', async () => {
    const owner = await getUserClient(account.owner);
    const agent = await getUserClient(account.agents[0]);

    const { error: writeError } = await agent
      .from('accounts')
      .update({ business_type: 'should-not-persist' })
      .eq('id', account.accountId);

    // USING (is_account_member(id, 'admin')) filters the row out of the
    // UPDATE's target set entirely — PostgREST reports success with
    // zero rows touched, not an error. What proves the deny is that
    // the value never lands.
    expect(writeError).toBeNull();

    const { data: current, error: readError } = await owner
      .from('accounts')
      .select('business_type')
      .eq('id', account.accountId)
      .single();

    expect(readError).toBeNull();
    expect(current!.business_type).not.toBe('should-not-persist');
  });
});
