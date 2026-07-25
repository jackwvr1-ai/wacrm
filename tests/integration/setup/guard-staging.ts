// Anti-production guard for the integration suite. These tests create
// and delete real accounts and auth users through the service-role
// client — this file is the only thing standing between
// `npm run test:integration` and doing that against production.
//
// Wired as Vitest's `globalSetup`, so it runs once, before any test
// file or worker starts, and a failed assertion aborts the whole run
// before a single fixture is created.
import './load-env';

const STAGING_HOST = 'zkrjdsqkfokzoifslfve.supabase.co';

export function assertStagingUrl(
  url: string | undefined
): asserts url is string {
  if (!url) {
    throw new Error(
      '[integration tests] SUPABASE_TEST_URL is not set. Copy .env.test.example ' +
        'to .env.test.local and fill in the wacrm-staging credentials.'
    );
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new Error(
      `[integration tests] SUPABASE_TEST_URL is not a valid URL: "${url}"`
    );
  }

  if (host !== STAGING_HOST) {
    throw new Error(
      `[integration tests] Refusing to run: SUPABASE_TEST_URL ("${url}") does not ` +
        `point at wacrm-staging (${STAGING_HOST}). Integration tests must never run ` +
        'against any other project.'
    );
  }
}

export default function globalSetup(): void {
  assertStagingUrl(process.env.SUPABASE_TEST_URL);
}
