// FEE-12. The money-position projection rated its fee estimate on the invoice
// amount, which is VAT-inclusive for a VAT-registered contractor. So two trades
// quoting identical work saw different projected fees, and the registered one
// saw a figure a fifth too high — on a £10,000 net job, £28.00 where £25.00 is
// what settlement actually takes.
//
// It is a projection rather than a charge, which is why this was split out of
// FEE-6 rather than folded into it: nobody was billed the wrong amount. The
// number on the dashboard was still wrong.
//
// The property asserted here is the one that fails precisely when the defect is
// present: the fee must not depend on VAT registration, because the ladder
// rates the net subtotal and the subtotal is the same either way.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Filters = Record<string, unknown>;

let applied: { table: string; filters: Filters }[];
let rows: Record<string, Record<string, unknown>[]>;

const resolvePath = (row: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);

const applyFilters = (table: string, filters: Filters): Record<string, unknown>[] =>
  (rows[table] ?? []).filter((row) =>
    Object.entries(filters).every(([column, value]) => resolvePath(row, column) === value),
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
    maybeSingle: async () => ({ data: applyFilters(table, filters)[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
      resolve({ data: applyFilters(table, filters), error: null }),
  };
  return query;
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => makeQuery(table),
  }),
}));

// One labour line priced at £10,000 net. The invoice amount differs by VAT
// treatment; the line items do not, which is the whole point.
const lineItems = [
  {
    description: "Work",
    category: "labour" as const,
    quantity: 1,
    unit: "job",
    unit_price: 10_000,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
  },
];

const unpaidInvoice = (grossPounds: number) => ({
  id: "inv-1",
  amount: grossPounds,
  created_at: "2026-08-01T00:00:00.000Z",
  status: "sent",
  quotes: {
    job_id: "job-1",
    line_items_json: lineItems,
    jobs: { contractor_id: "contractor-1", customer_id: "cust-1", customers: { name: "Smith Ltd" } },
  },
});

const seed = (vatRegistered: boolean, grossPounds: number) => {
  applied = [];
  rows = {
    contractors: [
      {
        id: "contractor-1",
        vat_registered: vatRegistered,
        free_jobs_remaining: 0,
        user_id: "user-1",
      },
    ],
    invoices: [unpaidInvoice(grossPounds)],
    jobs: [],
    job_costs: [],
  };
};

const feesOnOwed = async () => {
  const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
  const position = await getMoneyPosition("contractor-1");
  return position.projection.feesOnOwed;
};

describe("the money projection rates its fee on the net job value", () => {
  beforeEach(() => vi.resetModules());

  it("projects an identical fee whether or not the contractor is VAT-registered", async () => {
    // Same £10,000 of work. Registered bills £12,000 gross; unregistered £10,000.
    seed(true, 12_000);
    const registered = await feesOnOwed();

    seed(false, 10_000);
    const unregistered = await feesOnOwed();

    expect(registered).toBe(unregistered);
  });

  it("projects the ladder fee for the net value, not the gross one", async () => {
    // £10,000 net on the ladder: £5,000 × 0.3% + £5,000 × 0.2% = £25.00.
    // Rating the £12,000 gross would give £28.00, which is the defect.
    seed(true, 12_000);
    expect(await feesOnOwed()).toBe(2500);
  });
});
