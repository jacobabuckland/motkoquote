// Money position breakdown: VAT, fees, and forward projection.
//
// Before this ticket, whatsLeft was a bare scalar (collected − costs) that
// over-stated a trade's spendable cash in three ways:
//
// 1. No VAT term. For a VAT-registered trade, collected is gross, so it
//    includes money that belongs to HMRC.
// 2. No motko fee term. Fees where fee_status = 'collected' have actually left
//    the trade's money; the computation ignored them.
// 3. VAT extracted at the wrong rate. The code computed vatAmount = amount * 0.2,
//    but invoices.amount is already gross. Extracting VAT from gross is
//    gross − gross/1.2, not gross * 0.2. On £1,200 gross (£1,000 net + £200 VAT),
//    the card reported £240 — a 20% over-statement.
//
// This ticket returns a SafeToSpend breakdown (collected, costsPaid, motkoFees,
// vatToSetAside, total) and a Projection (owedNet, unpaidCostsNet, feesOnOwed,
// total), so the card can show its working and the arithmetic is verifiable.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Filters = Record<string, unknown>;

let applied: { table: string; filters: Filters }[];
let rows: Record<string, Record<string, unknown>[]>;

const resolvePath = (row: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);

const applyFilters = (
  table: string,
  filters: Filters,
): Record<string, unknown>[] =>
  (rows[table] ?? []).filter((row) =>
    Object.entries(filters).every(
      ([column, value]) => resolvePath(row, column) === value,
    ),
  );

const makeQuery = (table: string) => {
  const filters: Filters = {};
  applied.push({ table, filters });

  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    single: async () => ({ data: applyFilters(table, filters)[0] ?? null, error: null }),
    maybeSingle: async () => ({
      data: applyFilters(table, filters)[0] ?? null,
      error: null,
    }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: applyFilters(table, filters), error: null }),
  };
  return query;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => makeQuery(table),
  }),
}));

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  amount: 119.04, // numeric(10,2) POUNDS, converted to pence downstream
  created_at: "2026-08-01T00:00:00.000Z",
  status: "paid",
  quotes: {
    job_id: "job-1",
    jobs: {
      contractor_id: "contractor-1",
      customer_id: "cust-1",
      customers: { name: "Smith Ltd" },
    },
  },
  ...over,
});

const job = (over: Record<string, unknown> = {}) => ({
  id: "job-1",
  contractor_id: "contractor-1",
  fee_amount_pennies: null,
  fee_status: "not_applicable",
  ...over,
});

const cost = (over: Record<string, unknown> = {}) => ({
  id: "cost-1",
  job_id: "job-1",
  contractor_id: "contractor-1",
  counterparty_id: "cp-1",
  amount_net: 5000, // pence
  vat_amount: 1000, // pence
  paid: true,
  counterparty: { name: "Supplier Ltd" },
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  applied = [];
  rows = {
    contractors: [
      {
        id: "contractor-1",
        owner_user_id: "user-1",
        vat_registered: true,
        free_jobs_remaining: 5,
      },
    ],
    invoices: [],
    jobs: [],
    job_costs: [],
  };
});

describe("SafeToSpend breakdown", () => {
  it("deducts VAT correctly (not 20% of gross)", async () => {
    // One paid invoice, gross £119.04. Before this ticket the code computed
    // vatAmount = 119.04 * 0.2 = £23.81 (2381p). Correct extraction is
    // gross − gross/1.2 = 119.04 − 99.20 = £19.84 (1984p).
    rows.invoices = [invoice()];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.collected).toBe(11904);
    expect(position.safeToSpend.vatToSetAside).toBe(1984);
    expect(
      position.safeToSpend.vatToSetAside,
      "VAT extracted at 20% of gross (the old bug) would be 2381",
    ).not.toBe(2381);
    expect(position.safeToSpend.motkoFees).toBe(0);
    expect(position.safeToSpend.costsPaid).toBe(0);
    expect(position.safeToSpend.total).toBe(9920); // 11904 − 1984
  });

  it("deducts collected fees (fee_status = 'collected')", async () => {
    rows.invoices = [invoice()];
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "collected" })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.motkoFees).toBe(500);
    expect(position.safeToSpend.total).toBe(9420); // 11904 − 1984 − 500
  });

  it("does not deduct accrued fees (fee_status = 'accrued')", async () => {
    // Accrued fees are owed but not yet taken from cash in hand.
    rows.invoices = [invoice()];
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "accrued" })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.motkoFees).toBe(0);
    expect(position.safeToSpend.total).toBe(9920); // unaffected
  });

  it("does not deduct waived fees (fee_status = 'waived_refund')", async () => {
    rows.invoices = [invoice()];
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "waived_refund" })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.motkoFees).toBe(0);
    expect(position.safeToSpend.total).toBe(9920);
  });

  it("deducts paid costs at net + VAT, as today", async () => {
    rows.invoices = [invoice()];
    rows.job_costs = [cost({ amount_net: 3000, vat_amount: 600, paid: true })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.costsPaid).toBe(3600); // 3000 + 600
    expect(position.safeToSpend.total).toBe(6320); // 11904 − 1984 − 3600
  });

  it("returns vatToSetAside = null when not VAT-registered", async () => {
    rows.contractors[0]!.vat_registered = false;
    rows.invoices = [invoice()];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.vatToSetAside).toBeNull();
    // With no VAT deduction, total = collected − costsPaid − motkoFees
    expect(position.safeToSpend.total).toBe(11904);
  });

  it("the breakdown sums to the total (by recomputation)", async () => {
    rows.invoices = [invoice()];
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "collected" })];
    rows.job_costs = [cost({ amount_net: 3000, vat_amount: 600, paid: true })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    const b = position.safeToSpend;
    expect(b.total).toBe(
      b.collected - b.costsPaid - b.motkoFees - (b.vatToSetAside ?? 0),
    );
  });

  it("the fee term is present at zero when no fees exist", async () => {
    rows.invoices = [invoice()];
    // no jobs rows at all

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend).toHaveProperty("motkoFees");
    expect(position.safeToSpend.motkoFees).toBe(0);
  });

  it("returns a negative total when costs + fees exceed collected", async () => {
    rows.invoices = [invoice({ amount: 10 })]; // £10 = 1000p
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "collected" })];
    rows.job_costs = [cost({ amount_net: 8000, vat_amount: 1600, paid: true })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    // collected 1000, VAT 167, costs 9600, fees 500 → total negative
    expect(position.safeToSpend.total).toBeLessThan(0);
  });
});

describe("Projection", () => {
  it("computes owedNet at net (not gross) when VAT-registered", async () => {
    // Safe to spend £99.20, one owed invoice gross £240.00, no unpaid costs,
    // inside the free allowance (free_jobs_remaining = 5).
    rows.invoices = [
      invoice({ amount: 119.04, status: "paid" }),
      invoice({ id: "inv-owed", amount: 240.0, status: "sent" }),
    ];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.safeToSpend.total).toBe(9920);
    expect(position.projection.owedNet).toBe(20000); // 240 − 40 VAT
    expect(position.projection.unpaidCostsNet).toBe(0);
    expect(position.projection.feesOnOwed).toBe(0); // inside free allowance
    expect(position.projection.total).toBe(29920); // 9920 + 20000

    // Explicitly not 33920 (the spec's example was arithmetically wrong — it
    // added a gross owed figure to a total that had already had VAT removed).
    expect(
      position.projection.total,
      "the spec's worked example added £240 gross to a net total — that double-counts £40 of VAT",
    ).not.toBe(33920);
  });

  it("the projection sums (by recomputation)", async () => {
    rows.invoices = [
      invoice({ amount: 119.04, status: "paid" }),
      invoice({ id: "inv-owed", amount: 240.0, status: "sent" }),
    ];
    rows.job_costs = [cost({ amount_net: 5000, vat_amount: 1000, paid: false })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    const b = position.safeToSpend;
    const p = position.projection;
    expect(p.total).toBe(b.total + p.owedNet - p.unpaidCostsNet - p.feesOnOwed);
  });

  it("computes owedNet at gross when not VAT-registered", async () => {
    rows.contractors[0]!.vat_registered = false;
    rows.invoices = [
      invoice({ amount: 119.04, status: "paid" }),
      invoice({ id: "inv-owed", amount: 240.0, status: "sent" }),
    ];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.projection.owedNet).toBe(24000); // gross, no extraction
    expect(position.projection.total).toBe(35904); // 11904 + 24000
  });

  it("computes unpaidCostsNet at net when VAT-registered", async () => {
    // One unpaid cost, net 5000 + VAT 1000. unpaidCostsNet = 5000, not 6000.
    rows.invoices = [invoice({ amount: 119.04, status: "paid" })];
    rows.job_costs = [cost({ amount_net: 5000, vat_amount: 1000, paid: false })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.projection.unpaidCostsNet).toBe(5000);
    expect(
      position.projection.unpaidCostsNet,
      "unpaid costs reduce the projection at net, not gross, when VAT-registered",
    ).not.toBe(6000);
  });

  it("computes unpaidCostsNet at gross when not VAT-registered", async () => {
    rows.contractors[0]!.vat_registered = false;
    rows.invoices = [invoice({ amount: 119.04, status: "paid" })];
    rows.job_costs = [cost({ amount_net: 5000, vat_amount: 1000, paid: false })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.projection.unpaidCostsNet).toBe(6000); // gross
  });

  it("consumes the free allowance oldest-first", async () => {
    // free_jobs_remaining = 1, two owed invoices of £500 and £2,000, the £500
    // older. The older invoice is free; the £2,000 attracts FEE_LARGE_PENNIES
    // (400p) because it is over the £1,000 band threshold.
    rows.contractors[0]!.free_jobs_remaining = 1;
    rows.invoices = [
      invoice({ amount: 119.04, status: "paid" }),
      invoice({
        id: "inv-owed-old",
        amount: 5.0, // £5 (£500 in the spec was likely £5.00)
        status: "sent",
        created_at: "2026-08-01T00:00:00.000Z",
      }),
      invoice({
        id: "inv-owed-new",
        amount: 2000.0, // £2,000
        status: "sent",
        created_at: "2026-08-15T00:00:00.000Z",
      }),
    ];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    // The older (£5) invoice consumes the one free credit.
    // The newer (£2,000) invoice is over the £1,000 band, so FEE_LARGE_PENNIES = 400.
    expect(position.projection.feesOnOwed).toBe(400);
  });

  it("returns feesOnOwed = 0 when inside the free allowance", async () => {
    rows.contractors[0]!.free_jobs_remaining = 5;
    rows.invoices = [
      invoice({ amount: 119.04, status: "paid" }),
      invoice({ id: "inv-owed", amount: 240.0, status: "sent" }),
    ];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    expect(position.projection.feesOnOwed).toBe(0);
  });
});

describe("whatsLeft unchanged (PNL-4 owns it)", () => {
  it("whatsLeft still equals collected − costsPaid", async () => {
    rows.invoices = [invoice({ amount: 119.04, status: "paid" })];
    rows.jobs = [job({ fee_amount_pennies: 500, fee_status: "collected" })];
    rows.job_costs = [cost({ amount_net: 3000, vat_amount: 600, paid: true })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition("contractor-1");

    // whatsLeft is the OLD scalar: collected − costsPaid, no VAT or fee term.
    // safeToSpend.total is the NEW breakdown: collected − costsPaid − motkoFees − VAT.
    expect(position.whatsLeft).toBe(11904 - 3600);
    expect(position.whatsLeft).not.toBe(position.safeToSpend.total);
  });
});
