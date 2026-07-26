import { describe, it, expect, vi, beforeEach } from "vitest";

// M4: the account purge is a multi-step scrub that can't be one transaction, so
// it must be (a) guarded by a run lock, (b) resumable — purged_at is written
// LAST and on its own, so an interrupted contractor stays unpurged and is
// re-scrubbed next run, and (c) fault-isolated — one contractor erroring can't
// stall the rest of the batch.
const h = vi.hoisted(() => ({
  acquire: vi.fn(async () => true),
  release: vi.fn(async () => undefined),
  faultTable: null as string | null, // table that throws for the "bad" contractor
}));

vi.mock("@/lib/cron-auth", () => ({ rejectUnauthorizedCron: () => null }));
vi.mock("@/lib/cron-lock", () => ({
  acquireCronLock: h.acquire,
  releaseCronLock: h.release,
}));

type Row = Record<string, unknown>;

const makeAdmin = (store: Record<string, Row[]>) => {
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let mode = "select";
    let payload: Row | null = null;

    const run = () => {
      const rows = (store[table] ??= []);
      const matched = rows.filter((r) =>
        filters.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)),
      );
      // Fault injection: a chosen table throws while scrubbing contractor "bad".
      if (h.faultTable === table && filters.some(([c, v]) => c === "contractor_id" && v === "bad")) {
        throw new Error("boom");
      }
      if (mode === "update") matched.forEach((r) => Object.assign(r, payload));
      if (mode === "delete") store[table] = rows.filter((r) => !matched.includes(r));
      return { data: matched, error: null };
    };

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.update = (p: Row) => ((mode = "update"), (payload = p), q);
    q.delete = () => ((mode = "delete"), q);
    q.eq = (c: string, v: unknown) => (filters.push([c, v]), q);
    q.is = (c: string, v: unknown) => (filters.push([c, v]), q);
    q.lte = () => q;
    q.not = () => q;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve);
    return q;
  };
  return { from } as never;
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => currentAdmin,
}));

let currentAdmin: never;

import { GET } from "@/app/api/cron/purge-accounts/route";

const dueContractors = () => [
  { id: "good", owner_user_id: "ug", purged_at: null, purge_after: "2020-01-01" },
  { id: "bad", owner_user_id: "ub", purged_at: null, purge_after: "2020-01-01" },
];

const req = {} as never;

describe("purge-accounts — atomicity & resumability (M4)", () => {
  beforeEach(() => {
    h.acquire.mockClear();
    h.release.mockClear();
    h.acquire.mockResolvedValue(true);
    h.faultTable = null;
  });

  it("no-ops when the run lock is held", async () => {
    h.acquire.mockResolvedValueOnce(false);
    currentAdmin = makeAdmin({ contractors: dueContractors() });
    const res = await GET(req);
    expect(await res.json()).toEqual({ purged: 0, skipped: "locked" });
  });

  it("always releases the lock", async () => {
    currentAdmin = makeAdmin({ contractors: dueContractors() });
    await GET(req);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("marks the completed contractor purged but leaves an errored one unpurged (resumable + isolated)", async () => {
    const store: Record<string, Row[]> = { contractors: dueContractors() };
    currentAdmin = makeAdmin(store);
    // The 'bad' contractor throws partway through its scrub (on the jobs step).
    h.faultTable = "jobs";

    const res = await GET(req);

    const good = store.contractors.find((c) => c.id === "good")!;
    const bad = store.contractors.find((c) => c.id === "bad")!;
    // Good one fully scrubbed and stamped complete...
    expect(good.company_name).toBe("Deleted account");
    expect(good.purged_at).not.toBeNull();
    // ...the bad one never gets its completion marker, so it retries next run.
    expect(bad.purged_at).toBeNull();
    expect(await res.json()).toEqual({ purged: 1 });
  });

  // M5/#16: the purge anonymises in place — it must NEVER delete an issued
  // quote/invoice/contract (the legal/tax record we retain). This proves the
  // financial chain survives a completed purge intact, while the PII rows are
  // scrubbed-not-destroyed, so 0030's ON DELETE RESTRICT is never even reached.
  it("retains financial records intact and only anonymises PII in place", async () => {
    const store: Record<string, Row[]> = {
      contractors: [{ id: "good", owner_user_id: "ug", purged_at: null, purge_after: "2020-01-01" }],
      quotes: [{ id: "q1", contractor_id: "good", total: 500, status: "accepted" }],
      invoices: [{ id: "i1", quote_id: "q1", amount: 500, status: "paid" }],
      contracts: [{ id: "c1", quote_id: "q1", status: "signed" }],
      customers: [{ id: "cust1", contractor_id: "good", name: "Jane Real", contact: { email: "jane@x.com" } }],
    };
    currentAdmin = makeAdmin(store);

    const res = await GET(req);
    expect(await res.json()).toEqual({ purged: 1 });

    // Financial records are untouched — same rows, same values, none deleted.
    expect(store.quotes).toEqual([{ id: "q1", contractor_id: "good", total: 500, status: "accepted" }]);
    expect(store.invoices).toEqual([{ id: "i1", quote_id: "q1", amount: 500, status: "paid" }]);
    expect(store.contracts).toEqual([{ id: "c1", quote_id: "q1", status: "signed" }]);

    // Customer row survives (so invoices still resolve) but its PII is scrubbed.
    expect(store.customers).toHaveLength(1);
    expect(store.customers[0]).toMatchObject({ name: "Deleted customer", contact: {} });

    // The contractor row itself is anonymised, not removed.
    expect(store.contractors).toHaveLength(1);
    expect(store.contractors[0]).toMatchObject({ company_name: "Deleted account", purged_at: expect.anything() });
  });
});
