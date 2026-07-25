import { afterEach, describe, expect, it, vi } from "vitest";

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

type TableResult = { data: unknown; error: unknown };

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  // A plain result is returned on every call to that table. An array is
  // treated as a queue — one entry consumed per call, the last entry
  // repeating once exhausted — for tests where the same table is
  // queried twice with different results (recovery retry).
  byTable: Record<string, TableResult | TableResult[]>;
  rpc?: Record<string, TableResult>;
}) {
  const calls: BuilderCall[] = [];
  const rpcCalls: string[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        const entry = opts.byTable[table] ?? { data: null, error: null };
        if (Array.isArray(entry)) {
          return Promise.resolve(entry.length > 1 ? entry.shift()! : entry[0]);
        }
        return Promise.resolve(entry);
      },
    };
    return builder;
  };

  return {
    calls,
    rpcCalls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve(
          opts.rpc?.[name] ?? { data: null, error: null },
        );
      },
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, UnauthorizedError, ForbiddenError } = await import(
  "./account"
);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Could not load account context");
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  // Orphaned-user recovery (_fase3/INSTRUCCIONES-fix-huerfano.md,
  // 037_recover_orphaned_profile.sql): handle_new_user's EXCEPTION WHEN
  // OTHERS can silently roll back both its account+profile inserts,
  // leaving an authenticated user with NO profile row at all.
  describe("orphaned-profile recovery", () => {
    it("self-heals by calling recover_orphaned_profile and retrying once", async () => {
      const { client, rpcCalls } = makeClient({
        user: { id: "user-1" },
        byTable: {
          // First read: no profile row (the orphaned state). Second
          // read, after recovery: the freshly-created profile.
          profiles: [
            { data: null, error: null },
            {
              data: { account_id: "acct-new", account_role: "owner" },
              error: null,
            },
          ],
          accounts: { data: { id: "acct-new", name: "New" }, error: null },
        },
        rpc: { recover_orphaned_profile: { data: "acct-new", error: null } },
      });
      createClient.mockReturnValue(client);

      const ctx = await getCurrentAccount();

      expect(rpcCalls).toEqual(["recover_orphaned_profile"]);
      expect(ctx).toMatchObject({
        accountId: "acct-new",
        role: "owner",
        account: { id: "acct-new", name: "New" },
      });
    });

    it("falls through to ForbiddenError when recovery itself fails", async () => {
      const { client } = makeClient({
        user: { id: "user-1" },
        byTable: {
          profiles: { data: null, error: null },
        },
        rpc: {
          recover_orphaned_profile: {
            data: null,
            error: { message: "boom" },
          },
        },
      });
      createClient.mockReturnValue(client);

      await expect(getCurrentAccount()).rejects.toThrow(
        "Profile is not linked to an account",
      );
    });
  });
});
