import { describe, it, expect, vi, beforeEach } from "vitest";

// chargeMandate is the real-money boundary — its call count is the assertion
// that matters for H1 (fee double-charge). Always "authorized" so the collection
// stays pending (a healthy charge awaiting the settlement webhook).
// Hoisted so the vi.mock factory can reference it (vi.mock runs before module body).
const { chargeMandate } = vi.hoisted(() => ({
  chargeMandate: vi.fn(async () => ({ id: "pay-1", status: "authorized" })),
}));
vi.mock("@/lib/truelayer-vrp", () => ({ chargeMandate }));
vi.mock("@/lib/email", () => ({ sendContractorNotificationEmail: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));

import { runFeeCollectionBatch, retryFailedCollections } from "@/lib/collect-fees";

// Minimal in-memory Supabase stub that honours the fee_collections
// (contractor_id, period_start) unique index via upsert ignoreDuplicates — the
// exact database guarantee the H1 fix relies on.
type Row = Record<string, unknown>;
const matches = (row: Row, filters: [string, string, unknown][]) =>
  filters.every(([op, c, v]) => {
    if (op === "eq") return row[c] === v;
    if (op === "neq") return row[c] !== v;
    if (op === "in") return (v as unknown[]).includes(row[c]);
    if (op === "lt") return (row[c] as string) < (v as string);
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
      if (mode === "select") return { data: rows.filter((r) => matches(r, filters)), error: null };
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
          (r) => r.contractor_id === row.contractor_id && r.period_start === row.period_start,
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
    q.lt = (c: string, v: unknown) => (filters.push(["lt", c, v]), q);
    q.update = (p: Row) => ((mode = "update"), (payload = p), q);
    q.insert = (p: Row) => ((mode = "insert"), (payload = p), q);
    q.upsert = (p: Row, o: typeof opts) => ((mode = "upsert"), (payload = p), (opts = o), q);
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

const PERIOD = { periodStart: "2026-06-01", periodEnd: "2026-06-30", now: "2026-07-01T04:00:00.000Z" };

describe("runFeeCollectionBatch — exactly-once (H1)", () => {
  beforeEach(() => chargeMandate.mockClear());

  it("charges the mandate once even when the cron runs twice before settlement", async () => {
    const store: Record<string, Row[]> = {
      jobs: [{ id: "j1", contractor_id: "c1", fee_amount_pennies: 400, fee_status: "accrued" }],
      contractors: [contractor()],
      fee_collections: [],
    };
    const admin = makeAdmin(store);

    await runFeeCollectionBatch(admin, PERIOD);
    await runFeeCollectionBatch(admin, PERIOD); // re-run before the webhook settles

    expect(chargeMandate).toHaveBeenCalledTimes(1);
    expect(store.fee_collections).toHaveLength(1);
  });

  it("does not re-charge when the webhook settled the jobs between runs", async () => {
    const store: Record<string, Row[]> = {
      jobs: [{ id: "j1", contractor_id: "c1", fee_amount_pennies: 400, fee_status: "accrued" }],
      contractors: [contractor()],
      fee_collections: [],
    };
    const admin = makeAdmin(store);

    await runFeeCollectionBatch(admin, PERIOD);
    // Settlement webhook flips the jobs out of 'accrued'.
    store.jobs[0]!.fee_status = "collected";
    await runFeeCollectionBatch(admin, PERIOD);

    expect(chargeMandate).toHaveBeenCalledTimes(1);
    expect(store.fee_collections).toHaveLength(1);
  });
});

describe("retryFailedCollections — retries without re-accruing (H1)", () => {
  beforeEach(() => chargeMandate.mockClear());

  it("re-charges the existing failed collection in place, creating no new row", async () => {
    const store: Record<string, Row[]> = {
      contractors: [contractor()],
      fee_collections: [
        {
          id: "fc-existing",
          contractor_id: "c1",
          total_pennies: 400,
          attempts: 1,
          last_attempt_at: "2026-06-25T00:00:00.000Z", // > 3 days before `now`
          status: "failed",
          job_ids: ["j1"],
        },
      ],
    };
    const admin = makeAdmin(store);

    await retryFailedCollections(admin, { now: "2026-07-01T00:00:00.000Z" });

    expect(chargeMandate).toHaveBeenCalledTimes(1);
    expect(store.fee_collections).toHaveLength(1);
    expect(store.fee_collections[0]!.id).toBe("fc-existing");
  });
});
