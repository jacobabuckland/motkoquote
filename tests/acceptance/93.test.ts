import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks so vi.mock factories can reference them
// Both mocks declare their signatures rather than letting them be inferred.
// `async () => null` infers Promise<null>, so every mockResolvedValue({...})
// below is a type error; and a zero-argument chargeMandate makes mock.calls an
// empty tuple, so calls[0][0].idempotencyKey is an error too. Five in total.
// They were invisible because tsconfig had gained "tests" in exclude, taking
// the whole suite out of typecheck — reverted, so the mocks have to describe
// what the real functions actually take and return.
const { chargeMandate, getTrueLayerMandatePaymentStatus } = vi.hoisted(() => ({
  chargeMandate: vi.fn(
    async (_params: {
      mandateId: string;
      amountInMinor: number;
      reference: string;
      metadata: Record<string, string>;
      idempotencyKey: string;
    }) => ({ id: "pay-1", status: "authorized" }),
  ),
  getTrueLayerMandatePaymentStatus: vi.fn(
    async (): Promise<{ id: string; status: string } | null> => null,
  ),
}));

vi.mock("@/lib/truelayer-vrp", () => ({
  chargeMandate,
  getTrueLayerMandatePaymentStatus,
}));
vi.mock("@/lib/email", () => ({
  sendContractorNotificationEmail: vi.fn(async () => ({ delivered: true })),
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));

import { retryFailedCollections } from "@/lib/collect-fees";

// Minimal in-memory Supabase stub matching the one in collect-fees.test.ts
type Row = Record<string, unknown>;
const matches = (row: Row, filters: [string, string, unknown][]) =>
  filters.every(([op, c, v]) => {
    if (op === "eq") return row[c] === v;
    if (op === "neq") return row[c] !== v;
    if (op === "in") return (v as unknown[]).includes(row[c]);
    if (op === "not_in") return !(v as unknown[]).includes(row[c]);
    return true;
  });

const makeAdmin = (store: Record<string, Row[]>) => {
  let seq = 0;
  const from = (table: string) => {
    const rows = (store[table] ??= []);
    const filters: [string, string, unknown][] = [];
    let mode = "select";
    let payload: Row | null = null;
    let opts: { onConflict?: string; ignoreDuplicates?: boolean } | null = null;

    const run = () => {
      if (mode === "select")
        return { data: rows.filter((r) => matches(r, filters)), error: null };
      if (mode === "update") {
        const hit = rows.filter((r) => matches(r, filters));
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      if (mode === "delete") {
        store[table] = rows.filter((r) => !matches(r, filters));
        return { data: [], error: null };
      }
      // insert / upsert
      const row = payload as Row;
      if (table === "fee_collections") {
        const dup = rows.find(
          (r) =>
            r.contractor_id === row.contractor_id && r.period_start === row.period_start,
        );
        if (dup) {
          if (mode === "upsert" && opts?.ignoreDuplicates) return { data: [], error: null };
          return { data: null, error: { code: "23505" } };
        }
      }
      const created = { id: `fc-${++seq}`, attempts: 0, ...row };
      rows.push(created);
      return { data: [created], error: null };
    };

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (c: string, v: unknown) => (filters.push(["eq", c, v]), q);
    q.neq = (c: string, v: unknown) => (filters.push(["neq", c, v]), q);
    q.in = (c: string, v: unknown) => (filters.push(["in", c, v]), q);
    q.not = (c: string, operator: string, v: unknown) => {
      if (operator === "in") {
        const list = String(v).replace(/^\(|\)$/g, "").split(",");
        filters.push(["not_in", c, list]);
      }
      return q;
    };
    q.update = (p: Row) => ((mode = "update"), (payload = p), q);
    q.insert = (p: Row) => ((mode = "insert"), (payload = p), q);
    q.upsert = (p: Row, o: typeof opts) =>
      ((mode = "upsert"), (payload = p), (opts = o), q);
    q.delete = () => ((mode = "delete"), q);
    q.maybeSingle = async () => {
      const { data, error } = run();
      return { data: (data as Row[] | null)?.[0] ?? null, error };
    };
    q.single = q.maybeSingle;
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject);
    return q;
  };
  return { from } as never;
};

const contractor = () => ({
  id: "c1",
  owner_user_id: "u1",
  company_name: "Acme",
  business_profile: { business_email: "a@acme.test" },
  fee_mandate_id: "m1",
  fee_mandate_status: "authorized",
  fee_collection_status: "active",
});

describe("Issue #93: stable idempotency key per collection", () => {
  beforeEach(() => {
    chargeMandate.mockClear();
    chargeMandate.mockResolvedValue({ id: "pay-1", status: "authorized" });
    getTrueLayerMandatePaymentStatus.mockClear();
  });

  it("uses the same idempotency key across three attempts for the same collection", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-stable",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 0,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    // First attempt
    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });
    const firstKey = chargeMandate.mock.calls[0]?.[0]?.idempotencyKey;

    // Mark failed again and retry
    store.fee_collections[0]!.status = "failed";
    store.fee_collections[0]!.last_attempt_at = "2026-07-01T00:00:00.000Z";
    await retryFailedCollections(admin, { now: "2026-07-04T00:00:00.000Z" });
    const secondKey = chargeMandate.mock.calls[1]?.[0]?.idempotencyKey;

    // Mark failed again and retry
    store.fee_collections[0]!.status = "failed";
    store.fee_collections[0]!.last_attempt_at = "2026-07-04T00:00:00.000Z";
    await retryFailedCollections(admin, { now: "2026-07-07T00:00:00.000Z" });
    const thirdKey = chargeMandate.mock.calls[2]?.[0]?.idempotencyKey;

    // All three keys must be byte-identical
    expect(firstKey).toBeDefined();
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toBe(thirdKey);
    // The key should NOT contain the attempt number as a suffix
    expect(firstKey).not.toMatch(/:\d+$/);
  });
});

describe("Issue #93: chargeMandate wrapped in withTimeout", () => {
  beforeEach(() => {
    chargeMandate.mockClear();
    getTrueLayerMandatePaymentStatus.mockClear();
  });

  it("throws TimeoutError when chargeMandate times out", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-timeout",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    // Simulate a timeout by making chargeMandate hang indefinitely
    chargeMandate.mockImplementation(
      () => new Promise(() => {}) as Promise<{ id: string; status: string }>,
    );

    // This should complete (via timeout) rather than hanging forever
    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // The collection should be marked failed with a timeout reason
    const collection = store.fee_collections[0]!;
    expect(collection.status).toBe("failed");
    expect(collection.failure_reason).toMatch(/timeout|timed out/i);
  });
});

describe("Issue #93: status check before re-charge", () => {
  beforeEach(() => {
    chargeMandate.mockClear();
    chargeMandate.mockResolvedValue({ id: "pay-1", status: "authorized" });
    getTrueLayerMandatePaymentStatus.mockClear();
  });

  it("skips the re-charge when the prior attempt actually succeeded", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-retry",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
          provider_collection_ref: "pay-first-attempt",
        },
      ],
    };
    const admin = makeAdmin(store);

    // The prior attempt timed out on our side, but TrueLayer shows it executed
    getTrueLayerMandatePaymentStatus.mockResolvedValue({ id: "pay-first-attempt", status: "executed" });

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // No second charge should be issued
    expect(chargeMandate).toHaveBeenCalledTimes(0);
    // The status check was called with the prior payment id
    expect(getTrueLayerMandatePaymentStatus).toHaveBeenCalledWith("pay-first-attempt");
  });

  it("proceeds with the re-charge when the prior attempt genuinely failed", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-retry-fail",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
          provider_collection_ref: "pay-declined",
        },
      ],
    };
    const admin = makeAdmin(store);

    // The prior attempt genuinely failed
    getTrueLayerMandatePaymentStatus.mockResolvedValue({ id: "pay-declined", status: "failed" });

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // A second charge should be issued
    expect(chargeMandate).toHaveBeenCalledTimes(1);
  });

  it("waits when the prior attempt is still pending", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-pending",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
          provider_collection_ref: "pay-pending",
        },
      ],
    };
    const admin = makeAdmin(store);

    // The prior attempt is still executing
    getTrueLayerMandatePaymentStatus.mockResolvedValue({ id: "pay-pending", status: "authorizing" });

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // No charge should be issued; wait for the next cycle
    expect(chargeMandate).toHaveBeenCalledTimes(0);
    // The collection should remain failed
    expect(store.fee_collections[0]!.status).toBe("failed");
  });

  it("waits when the status query itself times out", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-query-timeout",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
          provider_collection_ref: "pay-unknown",
        },
      ],
    };
    const admin = makeAdmin(store);

    // The status query itself times out
    getTrueLayerMandatePaymentStatus.mockImplementation(
      () => new Promise(() => {}) as Promise<{ id: string; status: string } | null>,
    );

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // No charge should be issued when we can't verify the prior state
    expect(chargeMandate).toHaveBeenCalledTimes(0);
  });

  it("does not query status on the first attempt", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-first",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 0, // First attempt
          last_attempt_at: null,
          status: "pending",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    // Manually invoke chargeCollection path by marking it failed then retrying
    store.fee_collections[0]!.status = "failed";
    store.fee_collections[0]!.last_attempt_at = "2026-06-25T00:00:00.000Z";

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    // The charge should be issued without querying status (no prior attempt)
    expect(chargeMandate).toHaveBeenCalledTimes(1);
    expect(getTrueLayerMandatePaymentStatus).not.toHaveBeenCalled();
  });
});

describe("Issue #93: timeout and decline produce distinct log records", () => {
  beforeEach(() => {
    chargeMandate.mockClear();
    getTrueLayerMandatePaymentStatus.mockClear();
  });

  it("marks a timeout failure with a timeout-specific reason", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-timeout-log",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    chargeMandate.mockImplementation(
      () => new Promise(() => {}) as Promise<{ id: string; status: string }>,
    );

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    const collection = store.fee_collections[0]!;
    expect(collection.failure_reason).toMatch(/timeout|timed out/i);
  });

  it("marks a decline failure with the decline reason", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-decline-log",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z",
          status: "failed",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    chargeMandate.mockRejectedValue(new Error("Insufficient funds"));

    await retryFailedCollections(admin, { now: "2026-06-28T00:00:00.000Z" });

    const collection = store.fee_collections[0]!;
    expect(collection.failure_reason).toMatch(/insufficient funds/i);
    expect(collection.failure_reason).not.toMatch(/timeout|timed out/i);
  });
});
