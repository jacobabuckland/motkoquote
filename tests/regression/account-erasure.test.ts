// Account erasure — the fix for the 1 Sept 2026 defect where an account
// "deleted" at 07:14 signed back in with the same password at 07:36.
//
// The two properties under test are the two the old implementation lacked:
// every call's result is CHECKED (supabase-js returns errors rather than
// throwing them, so the old try/catch was unreachable and stamped `purged_at`
// over a scrub that had done nothing), and the auth user is deleted LAST, so a
// failure anywhere earlier leaves a working account rather than an orphaned
// pile of rows.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const closeConnectedAccount = vi.fn(async (_id?: string) => true);
const getOutstandingFundsState = vi.fn(
  async (_id?: string): Promise<{ pennies: number; expectedArrival: string | null } | null> => ({
    pennies: 0,
    expectedArrival: null,
  }),
);

vi.mock("@/lib/stripe", () => ({ stripe: {}, testMode: true }));
vi.mock("@/lib/stripe-connect", () => ({
  closeConnectedAccount: (id: string) => closeConnectedAccount(id),
  getOutstandingFundsState: (id: string) => getOutstandingFundsState(id),
}));

type Call = { table: string; op: string; payload?: Record<string, unknown> };

// Records every table write and every auth/storage call in the order they were
// made, so the ordering guarantee can be asserted rather than assumed. Any
// table named in `failOn` returns a Postgrest-shaped error instead — which is
// what supabase-js actually does, and what the previous implementation ignored.
const createAdminStub = (
  options: {
    failOn?: string;
    failAuthDelete?: boolean;
    quotes?: { id: string }[];
    contracts?: { id: string }[];
  } = {},
) => {
  const calls: Call[] = [];
  const { failOn, failAuthDelete, quotes = [{ id: "q1" }], contracts = [{ id: "ct1" }] } = options;

  const result = (table: string, op: string, payload?: Record<string, unknown>) => {
    calls.push({ table, op, payload });
    return failOn === table
      ? { data: null, error: { message: `simulated ${op} failure` } }
      : { data: null, error: null };
  };

  const from = (table: string) => {
    const terminal = (op: string, payload?: Record<string, unknown>) => {
      const settled = () => Promise.resolve(result(table, op, payload));
      const chain: Record<string, unknown> = {
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        then: (resolve: (value: unknown) => unknown) => settled().then(resolve),
      };
      return chain;
    };

    return {
      delete: () => terminal("delete"),
      update: (payload: Record<string, unknown>) => terminal("update", payload),
      select: () => {
        calls.push({ table, op: "select" });
        const rows = table === "quotes" ? quotes : contracts;
        const payload =
          failOn === table
            ? { data: null, error: { message: "simulated select failure" } }
            : { data: rows, error: null };
        const chain: Record<string, unknown> = {
          eq: () => chain,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(payload).then(resolve),
        };
        return chain;
      },
    };
  };

  const storageRemove = vi.fn(async (_paths?: string[]) => {
    calls.push({ table: "storage", op: "remove" });
    return failOn === "storage" ? { error: { message: "simulated storage failure" } } : { error: null };
  });

  const deleteUser = vi.fn(async (_id?: string) => {
    calls.push({ table: "auth", op: "deleteUser" });
    return failAuthDelete ? { error: { message: "simulated auth failure" } } : { error: null };
  });

  const client = {
    from,
    storage: {
      from: () => ({
        list: async () => ({ data: [{ name: "clip.webm" }], error: null }),
        remove: storageRemove,
      }),
    },
    auth: { admin: { deleteUser } },
  } as unknown as SupabaseClient;

  return { client, calls, deleteUser, storageRemove };
};

const INPUT = {
  userId: "user-1",
  contractorId: "contractor-1",
  stripeAccountId: "acct_1",
};

describe("eraseAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeConnectedAccount.mockResolvedValue(true);
    getOutstandingFundsState.mockResolvedValue({ pennies: 0, expectedArrival: null });
  });

  it("deletes the auth user, and does it last", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client, calls, deleteUser } = createAdminStub();

    const result = await eraseAccount(client, INPUT);

    expect(result).toEqual({ ok: true, alreadyErased: false });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    // The whole defect in one assertion: the auth identity is the last thing to
    // go, so nothing before it can leave an orphaned auth user behind.
    expect(calls.at(-1)).toEqual({ table: "auth", op: "deleteUser" });
  });

  it("erases every store D4 names", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client, calls, storageRemove } = createAdminStub();

    await eraseAccount(client, INPUT);

    const touched = new Set(calls.map((c) => c.table));
    for (const table of [
      "knowledge_chunks",
      "team_members",
      "merchant_accounts",
      "rate_cards",
      "contractor_material_prices",
      "counterparties",
      "quote_line_edits",
      "events",
      "jobs",
      "customers",
      "push_subscriptions",
      "notification_preferences",
      "contractors",
    ]) {
      expect(touched, `${table} must be erased or anonymised`).toContain(table);
    }
    // The old purge nulled jobs.source_audio_url and left the audio itself in
    // the bucket — unreferenced, unfindable, and still there.
    expect(storageRemove).toHaveBeenCalled();
  });

  // Found by running the erasure against production, which is the wrong place
  // to find it. contracts.status_changed_at is GENERATED ALWAYS AS
  // (coalesce(signed_at, declined_at)); Postgres rejects any write to it with
  // "column can only be updated to DEFAULT" and fails the whole statement. The
  // stub accepts any column name, so nothing above could have caught it — this
  // asserts on the payload precisely because the shape is the defect.
  it("never writes a generated column when voiding a contract", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client, calls } = createAdminStub();

    await eraseAccount(client, INPUT);

    const contractUpdates = calls.filter((c) => c.table === "contracts" && c.op === "update");
    expect(contractUpdates.length).toBeGreaterThan(0);
    for (const update of contractUpdates) {
      expect(Object.keys(update.payload ?? {})).not.toContain("status_changed_at");
    }
    // The void itself must still happen — the fix is dropping one field, not
    // the statement.
    expect(contractUpdates.some((u) => u.payload?.status === "void")).toBe(true);
  });

  it("closes the Stripe connected account", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client } = createAdminStub();

    await eraseAccount(client, INPUT);

    expect(closeConnectedAccount).toHaveBeenCalledWith("acct_1");
  });

  it("skips Stripe entirely when there is no connected account", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client, deleteUser } = createAdminStub();

    const result = await eraseAccount(client, { ...INPUT, stripeAccountId: null });

    expect(result.ok).toBe(true);
    expect(closeConnectedAccount).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalled();
  });

  // The heart of it. supabase-js resolves rather than rejects on a query error,
  // so an unchecked `await` on a failed write is indistinguishable from a
  // successful one — which is how the old purge stamped itself complete having
  // scrubbed nothing.
  describe.each([
    ["knowledge_chunks", "data_erase_failed"],
    ["jobs", "data_erase_failed"],
    ["customers", "data_erase_failed"],
    ["push_subscriptions", "data_erase_failed"],
    ["storage", "storage_failed"],
    ["contractors", "anonymise_failed"],
  ])("when %s fails", (table, expectedCode) => {
    it(`aborts with ${expectedCode} and leaves the auth user intact`, async () => {
      const { eraseAccount } = await import("@/lib/account-erasure");
      const { client, deleteUser } = createAdminStub({ failOn: table });

      const result = await eraseAccount(client, INPUT);

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe(expectedCode);
      // The account must still be usable: a half-deleted account is the worst
      // outcome and must not be reachable (D2).
      expect(deleteUser).not.toHaveBeenCalled();
    });
  });

  it("aborts rather than orphaning a connected account Stripe would not close", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    closeConnectedAccount.mockResolvedValue(false);
    const { client, deleteUser } = createAdminStub();

    const result = await eraseAccount(client, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("stripe_close_failed");
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("reports a failed auth delete instead of returning success", async () => {
    const { eraseAccount } = await import("@/lib/account-erasure");
    const { client } = createAdminStub({ failAuthDelete: true });

    const result = await eraseAccount(client, INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("auth_delete_failed");
  });
});

describe("checkErasurePreconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOutstandingFundsState.mockResolvedValue({ pennies: 0, expectedArrival: null });
  });

  it("allows an account with nothing outstanding", async () => {
    const { checkErasurePreconditions } = await import("@/lib/account-erasure");
    await expect(checkErasurePreconditions("acct_1")).resolves.toEqual({
      ok: true,
      alreadyErased: false,
    });
  });

  it("blocks a pending payout, naming the amount and when it lands", async () => {
    const { checkErasurePreconditions } = await import("@/lib/account-erasure");
    getOutstandingFundsState.mockResolvedValue({
      pennies: 42350,
      expectedArrival: "4 September 2026",
    });

    const result = await checkErasurePreconditions("acct_1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("outstanding_funds");
    expect(result.message).toContain("£423.50");
    expect(result.message).toContain("4 September 2026");
  });

  it("blocks when Stripe is unreachable — an unverified precondition is not a satisfied one", async () => {
    const { checkErasurePreconditions } = await import("@/lib/account-erasure");
    getOutstandingFundsState.mockResolvedValue(null);

    const result = await checkErasurePreconditions("acct_1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("stripe_unreachable");
    expect(result.message).toMatch(/try again/i);
  });

  it("does not consult Stripe when there is no connected account", async () => {
    const { checkErasurePreconditions } = await import("@/lib/account-erasure");
    const result = await checkErasurePreconditions(null);

    expect(result.ok).toBe(true);
    expect(getOutstandingFundsState).not.toHaveBeenCalled();
  });
});
