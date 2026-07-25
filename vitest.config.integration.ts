import { defineConfig } from 'vitest/config';

// Integration suite: hits a real wacrm-staging Supabase project
// (guarded by tests/integration/setup/guard-staging.ts) instead of
// mocks. Kept fully separate from vitest.config.ts / `npm test` —
// different config file, different `include`, own npm script
// (`npm run test:integration`) — so the 628 existing unit tests never
// pick these up and vice versa.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/integration/setup/guard-staging.ts'],
    setupFiles: ['./tests/integration/setup/load-env.ts'],
    // Real network calls to staging (auth admin API, RPCs, PostgREST)
    // are slower than the mocked unit suite's default 5s timeout.
    testTimeout: 20_000,
  },
});
