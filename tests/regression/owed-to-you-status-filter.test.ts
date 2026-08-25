// "Owed to you" was structurally always zero.
//
// getMoneyPosition filtered unpaid invoices with `.eq("status", "unpaid")`.
// Nothing in the product has ever written 'unpaid' — the string occurred
// exactly twice in all of src/, both in that one file — so the query matched
// nothing and every contractor was told they were owed nothing. The voice
// surface shares the same call, so it said it out loud: "You're all caught up
// — no outstanding invoices."
//
// Two things let it survive. There is no CHECK constraint on invoices.status,
// so a filter on a value that does not exist fails silently rather than
// loudly. And every existing test mocked getMoneyPosition itself (see
// tests/acceptance/257.test.ts), so the broken query was never executed by
// anything.
//
// These tests therefore run the REAL query against a recording client. The
// defect's signature is a plausible zero, so the assertions are on the filter
// that produces it, not only on the number that comes out.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Filters = Record<string, unknown>;

// Every .eq() the code applies to a given table, recorded in order.
let applied: { table: string; filters: Filters }[];
// Rows each table hands back, keyed by table name.
let rows: Record<string, Record<string, unknown>[]>;

// Resolves a Supabase filter path ("quotes.jobs.contractor_id") against a row.
const resolvePath = (row: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);

// The stub HONOURS the filters rather than ignoring them. That is the whole
// point: if it handed back rows regardless, a filter naming a status nothing
// writes would still produce a populated result and the tests below would pass
// against the very bug they exist to catch. (They did, on the first draft of
// this file.)
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
    // The invoice/cost queries are awaited directly rather than terminated by
    // .single(), so the builder has to be thenable.
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

// The filters applied to the FIRST query against a table — the unpaid-invoice
// fetch, before the later paid-invoice fetches for VAT and what's-left.
const firstFiltersFor = (table: string): Filters => {
  const entry = applied.find((a) => a.table === table && "status" in a.filters);
  return entry?.filters ?? {};
};

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  amount: 2400, // numeric(10,2) — POUNDS, converted to pence downstream
  created_at: "2026-07-12T00:00:00.000Z",
  status: "sent",
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

beforeEach(() => {
  vi.resetModules();
  applied = [];
  rows = {
    contractors: [
      { id: "contractor-1", owner_user_id: "user-1", vat_registered: false },
    ],
    invoices: [invoice()],
    job_costs: [],
  };
});

describe("which invoices count as owed", () => {
  it("filters on a status the product actually writes", async () => {
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    await getMoneyPosition();

    const status = firstFiltersFor("invoices").status;

    expect(
      status,
      "'unpaid' is never written by anything in src/ — this filter matches no row ever created",
    ).not.toBe("unpaid");

    // 'sent' is the issued-and-awaiting-payment state the rest of the product
    // already agrees on: create-payment-intent refuses to charge anything that
    // is not 'sent', the chase cron selects on it, the dashboard calls it
    // "Awaiting payment".
    expect(status).toBe("sent");
  });

  it("returns the money actually owed, not a plausible zero", async () => {
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition();

    expect(
      position.owedToYou,
      "a contractor with a sent, unpaid invoice is owed money",
    ).toHaveLength(1);
    // £2,400 in pence. aggregateByCustomer does the pounds->pence conversion;
    // invoices.amount is numeric(10,2) while job_costs are integer pence, so
    // the two sides of this object reach it in different units by design.
    expect(position.owedToYou[0]?.totalOwed).toBe(240000);
    expect(position.owedToYou[0]?.customerName).toBe("Smith Ltd");
  });

  it("excludes drafts, which the customer has never seen", async () => {
    // status defaults to 'draft', so a filter that let drafts through would
    // report money the contractor has not asked anyone for.
    rows.invoices = [invoice({ id: "inv-draft", status: "draft" })];

    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const position = await getMoneyPosition();

    expect(
      position.owedToYou,
      "a draft invoice is money the contractor has not asked anyone for",
    ).toHaveLength(0);
  });

  it("scopes to the signed-in contractor", async () => {
    // A leak here would show one trade another trade's money.
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    await getMoneyPosition();

    expect(firstFiltersFor("invoices")["quotes.jobs.contractor_id"]).toBe(
      "contractor-1",
    );
  });
});

describe("what the voice surface then says", () => {
  // The screen renders an empty panel; the voice surface speaks a sentence.
  // Same query, materially different consequence, so it gets its own guard.
  it("does not claim the trade is all caught up when they are owed money", async () => {
    const { getMoneyPosition } = await import("@/app/jobs/money-position-actions");
    const { formatOwedToYouResponse } = await import(
      "@/lib/voice/ledger-query-prompt"
    );

    const position = await getMoneyPosition();
    const spoken = formatOwedToYouResponse(position.owedToYou, {
      customerMentionedInQuery: false,
    });

    expect(
      spoken,
      "a false all-clear spoken aloud gets no second look — there is no figure on screen to check it against",
    ).not.toMatch(/all caught up/i);
    expect(spoken).toMatch(/You're owed/);
  });
});
