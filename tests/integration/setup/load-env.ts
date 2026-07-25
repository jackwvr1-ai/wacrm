// Loads `.env.test.local` into `process.env`. Runs both as Vitest's
// `globalSetup` (once, in the main process — see guard-staging.ts)
// and as a `setupFiles` entry (once per worker), since worker
// threads don't inherit env mutations made by the main process after
// they've spawned. `dotenv` never overwrites a var that's already
// set, so loading it twice (or alongside real env vars from CI) is
// safe.
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.test.local') });
