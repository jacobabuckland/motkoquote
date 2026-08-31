import { beforeEach, describe, expect, it, vi } from "vitest";

// settlePaidJob is the single settlement path shared by the TrueLayer webhook and
// the manual "mark as paid" action. These tests drive it against a hand-rolled
// in-memory fake of the exact PostgREST chains it uses, so the DB effects (invoice
// flip, per-job guard, fee accrual, ledger, referral) are asserted directly. The
// two side-effecting collaborators — analytics and the contractor notifier — are
// mocked to no-ops so we isolate the settlement logic. planPaidJobSettlement is
// left REAL: it's the deterministic money brain we want under test.
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/notify-contractor", () => ({
  notifyContractorOfCustomerAction: vi.fn(),
}));

import { settlePaidJob, type SettlementSource } from "@/lib/settle-paid-job";

// --- Minimal in-memory PostgREST fake -------------------------------------

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

type Filter =
  | { op: "eq" | "neq" | "is"; col: string; val: unknown }
  | { op: "not"; subop: string; col: string; val: unknown };

class Builder {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "insert" = "select";
  private payload: Row | Row[] | null = null;
  private counting = false;

  constructor(
    private db: Db,
    private table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.counting = true;
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }
  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push({ op: "eq", col, val });
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push({ op: "neq", col, val });
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push({ op: "is", col, val });
    return this;
  }
  not(col: string, subop: string, val: unknown) {
    this.filters.push({ op: "not", subop, col, val });
    return this;
  }

  private match(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.val;
      if (f.op === "neq") return v !== f.val;
      if (f.op === "is") return v === f.val;
      // not(col, "is", null) => v is NOT null
      return v !== f.val;
    });
  }

  private rows(): Row[] {
    return (this.db[this.table] ??= []);
  }

  private run(): { data: Row[] | null; count?: number } {
    if (this.mode === "insert") {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload!];
      for (const it of items) this.rows().push({ ...it });
      return { data: null };
    }
    const matched = this.rows().filter((r) => this.match(r));
    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.payload);
    }
    if (this.counting) return { data: null, count: matched.length };
    return { data: matched };
  }

  maybeSingle() {
    const r = this.run();
    return Promise.resolve({ data: r.data?.[0] ?? null, error: null });
  }
  single() {
    const r = this.run();
    return Promise.resolve({ data: r.data?.[0] ?? null, error: null });
  }
  // Terminal await (updates without a single(), inserts, count queries).
  then<T>(resolve: (v: { data: Row[] | null; count?: number }) => T) {
    return Promise.resolve(this.run()).then(resolve);
  }
}

const fakeAdmin = (db: Db) =>
  ({
    from: (table: string) => new Builder(db, table),
    // Models the increment_free_jobs_remaining and increment_activated_referral_count
    // SQL functions: atomic increments on contractor counters.
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "increment_free_jobs_remaining") {
        const row = (db.contractors ??= []).find((c) => c.id === args.p_id);
        if (row) {
          row.free_jobs_remaining =
            ((row.free_jobs_remaining as number) ?? 0) + (args.p_delta as number);
        }
        return { data: null, error: null };
      }
      if (name === "increment_activated_referral_count") {
        const row = (db.contractors ??= []).find((c) => c.id === args.contractor_id);
        if (row) {
          row.activated_referral_count = ((row.activated_referral_count as number) ?? 0) + 1;
          return { data: [{ activated_referral_count: row.activated_referral_count }], error: null };
        }
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  }) as never;

// --- Fixtures --------------------------------------------------------------

const CONTRACTOR = "trade-1";
const JOB = "job-1";

type InvoiceOpts = {
  id?: string;
  invoiceType?: string;
  amount?: number;
  total?: number;
};

const invoiceRow = (o: InvoiceOpts = {}): Row => ({
  id: o.id ?? "inv-1",
  status: "sent",
  invoice_type: o.invoiceType ?? "final",
  amount: o.amount ?? 500,
  paid_at: null,
  payment_method: null,
  truelayer_payment_id: null,
  quote: {
    total: o.total ?? 500,
    job: { id: JOB, contractor_id: CONTRACTOR, customer: { name: "Alex" } },
  },
});

const makeDb = (over: {
  invoices?: Row[];
  freeJobs?: number;
  referrals?: Row[];
  extraContractors?: Row[];
} = {}): Db => ({
  invoices: over.invoices ?? [invoiceRow()],
  jobs: [{ id: JOB, contractor_id: CONTRACTOR, paid_at: null }],
  contractors: [
    { id: CONTRACTOR, free_jobs_remaining: over.freeJobs ?? 0, activated_referral_count: 0 },
    ...(over.extraContractors ?? []),
  ],
  referrals: over.referrals ?? [],
  credit_events: [],
});

const settle = (db: Db, invoiceId: string, source: SettlementSource, paidAt?: string) =>
  settlePaidJob(fakeAdmin(db), {
    invoiceId,
    source,
    paymentMethod: source === "truelayer_webhook" ? "motko_bank" : "cash",
    ...(source === "truelayer_webhook" ? { paymentProviderRef: "tl-ref-1" } : {}),
    ...(paidAt ? { paidAt } : {}),
  });

beforeEach(() => vi.clearAllMocks());

// --- Banding ---------------------------------------------------------------

describe("settlePaidJob — manual settle fee banding", () => {
  it("accrues £2 floor for a job below the floor", async () => {
    const db = makeDb({ invoices: [invoiceRow({ total: 500 })], freeJobs: 0 });
    await settle(db, "inv-1", "manual");
    expect(db.jobs[0]!.fee_amount_pennies).toBe(200); // £500 * 0.3% = £1.50, floor applies → £2
    expect(db.jobs[0]!.fee_status).toBe("accrued");
  });

  it("charges £3 for a £1,000 job (first tier)", async () => {
    const db = makeDb({ invoices: [invoiceRow({ total: 1000 })], freeJobs: 0 });
    await settle(db, "inv-1", "manual");
    expect(db.jobs[0]!.fee_amount_pennies).toBe(300); // £1,000 * 0.3% = £3
    expect(db.jobs[0]!.job_value_pennies).toBe(100_000);
  });

  it("charges £4.50 for a £1,500 job (first tier)", async () => {
    const db = makeDb({ invoices: [invoiceRow({ total: 1500 })], freeJobs: 0 });
    await settle(db, "inv-1", "manual");
    expect(db.jobs[0]!.fee_amount_pennies).toBe(450); // £1,500 * 0.3% = £4.50
    expect(db.jobs[0]!.fee_status).toBe("accrued");
  });

  it("waives the floor and charges remainder with free credit (FEE-2)", async () => {
    const db = makeDb({ invoices: [invoiceRow({ total: 1500 })], freeJobs: 3 });
    await settle(db, "inv-1", "manual");
    // FEE-2: £1,500 job with free credit → £4.50 fee, £2 waived, £2.50 payable
    expect(db.jobs[0]!.fee_amount_pennies).toBe(250); // 450 - 200 = 250
    expect(db.jobs[0]!.fee_waived_amount_pennies).toBe(200);
    expect(db.jobs[0]!.fee_status).toBe("accrued");
    // Free-job burn recorded in the ledger and reflected in the cache.
    expect(db.credit_events).toHaveLength(1);
    expect(db.credit_events[0]).toMatchObject({ delta: -1, reason: "job_consumed" });
    expect(db.contractors[0]!.free_jobs_remaining).toBe(2);
  });
});

// --- Backdating ------------------------------------------------------------

describe("settlePaidJob — backdated paid-at", () => {
  it("stamps both invoice and job with the supplied (backdated) timestamp", async () => {
    const backdated = "2026-07-01T12:00:00.000Z";
    const db = makeDb();
    await settle(db, "inv-1", "manual", backdated);
    expect(db.invoices[0]!.paid_at).toBe(backdated);
    expect(db.jobs[0]!.paid_at).toBe(backdated);
    expect(db.invoices[0]!.payment_method).toBe("cash");
  });
});

// --- Idempotency / race (both orders) --------------------------------------

describe("settlePaidJob — webhook vs manual race", () => {
  const pendingReferral = () => [
    {
      id: "ref-1",
      referrer_contractor_id: "trade-2",
      referee_contractor_id: CONTRACTOR,
      status: "pending",
    },
  ];

  const runBothOrders = async (order: SettlementSource[]) => {
    const db = makeDb({
      invoices: [invoiceRow({ total: 1500 })],
      freeJobs: 0,
      referrals: pendingReferral(),
      extraContractors: [{ id: "trade-2", free_jobs_remaining: 0, activated_referral_count: 4 }],
    });
    await settle(db, "inv-1", order[0]!);
    await settle(db, "inv-1", order[1]!);
    return db;
  };

  it.each<[string, SettlementSource[]]>([
    ["webhook then manual", ["truelayer_webhook", "manual"]],
    ["manual then webhook", ["manual", "truelayer_webhook"]],
  ])("settles exactly once (%s) — first writer wins", async (_name, order) => {
    const db = await runBothOrders(order);

    // Invoice flipped once; the loser's conditional update no-ops.
    expect(db.invoices[0]!.status).toBe("paid");
    // Fee accrued exactly once on the job.
    expect(db.jobs[0]!.fee_amount_pennies).toBe(450); // £1,500 * 0.3% = £4.50
    // Referral activated exactly once; a single referral_unlock ledger entry.
    expect(db.referrals[0]!.status).toBe("activated");
    const unlocks = db.credit_events.filter((e) => e.reason === "referral_unlock");
    expect(unlocks).toHaveLength(1);
    // Referrer started with count=4, this is their 5th activation, so they get +5.
    expect(db.contractors.find((c) => c.id === "trade-2")!.free_jobs_remaining).toBe(5);
    expect(db.contractors.find((c) => c.id === "trade-2")!.activated_referral_count).toBe(5);
  });
});

// --- Staged job: deposit then final ----------------------------------------

describe("settlePaidJob — deposit then final", () => {
  it("bands the fee once on the full job value; each invoice still flips", async () => {
    const db = makeDb({
      invoices: [
        invoiceRow({ id: "inv-dep", invoiceType: "deposit", amount: 300, total: 1500 }),
        invoiceRow({ id: "inv-fin", invoiceType: "final", amount: 1200, total: 1500 }),
      ],
      freeJobs: 0,
    });

    await settle(db, "inv-dep", "manual");
    await settle(db, "inv-fin", "manual");

    // Both invoices settled.
    expect(db.invoices.find((i) => i.id === "inv-dep")!.status).toBe("paid");
    expect(db.invoices.find((i) => i.id === "inv-fin")!.status).toBe("paid");
    // Fee accrued exactly once, on the £1,500 job total (ladder: £4.50).
    expect(db.jobs[0]!.fee_amount_pennies).toBe(450); // £1,500 * 0.3% = £4.50
    expect(db.jobs[0]!.job_value_pennies).toBe(150_000);
    // No stray ledger entries (no allowance, no referral).
    expect(db.credit_events).toHaveLength(0);
  });
});
