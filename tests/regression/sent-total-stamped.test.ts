// The wiring half of #370.
//
// sentQuoteDivergence is pure and easy to test, and testing it proves nothing
// about whether quotes.sent_total is ever written. #375 shipped a correct
// formatter behind a column that was never selected — the formatter's unit
// tests all passed, and the feature was dead. This asserts the column actually
// reaches the database, and that it carries the figure the CUSTOMER was told
// rather than a second read that could observe something else.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineItem } from "@/lib/schemas/job";

const priced: LineItem = {
  description: "Consumer unit replacement",
  category: "labour",
  quantity: 1,
  unit: "day",
  unit_price: 95,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  people: [{ label: "Owner", days: 1, day_rate: 95 }],
};

/** Every UPDATE applied to the quotes table during one send. */
let quoteUpdates: Array<Record<string, unknown>> = [];
/** The amount handed to the customer-facing message. */
let messagedAmount: number | null = null;

const runSend = async (quoteTotal: number, confirmZeroTotal?: boolean) => {
  quoteUpdates = [];
  messagedAmount = null;
  vi.resetModules();

  const chain = (table: string): Record<string, unknown> => ({
    select: () => chain(table),
    eq: () => chain(table),
    in: () => chain(table),
    order: () => chain(table),
    limit: () => chain(table),
    single: async () => ({ data: rowFor(table), error: null }),
    maybeSingle: async () => ({ data: rowFor(table), error: null }),
    insert: () => ({
      select: () => ({ single: async () => ({ data: { id: "customer-1" }, error: null }) }),
    }),
    update: (payload: Record<string, unknown>) => {
      if (table === "quotes") quoteUpdates.push(payload);
      return chain(table);
    },
  });

  const rowFor = (table: string): unknown => {
    if (table === "jobs") {
      return {
        contractor_id: "contractor-1",
        customer_id: "customer-1",
        sow_json: null,
        contractor: { company_name: "Buckland Electrical Ltd", vat_registered: false },
      };
    }
    if (table === "quotes") {
      return {
        total: quoteTotal,
        line_items_json: [priced],
        drafted_line_items_json: null,
        contractor_flags_json: [],
      };
    }
    if (table === "customers") return { id: "customer-1" };
    return null;
  };

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chain(table),
    }),
  }));
  vi.doMock("@/lib/notify-customer", () => ({
    notifyCustomer: async (input: { amount: number }) => {
      messagedAmount = input.amount;
      return {
        email: { attempted: true, delivered: true },
        sms: { attempted: false, delivered: false },
        deliveredAnywhere: true,
      };
    },
  }));
  vi.doMock("@/lib/quote-learning", () => ({
    diffLineItems: () => [],
    recordQuoteEdits: async () => {},
    getContractorTendencies: async () => [],
  }));
  vi.doMock("@/lib/knowledge", () => ({
    syncQuoteKnowledge: async () => {},
    findSimilarPastJobs: async () => [],
  }));
  vi.doMock("@/lib/materials", () => ({
    rememberMaterialPrices: async () => {},
    findKnownMaterialPrices: async () => [],
  }));
  vi.doMock("@/lib/analytics", () => ({ track: async () => {}, logError: async () => {} }));

  const { sendQuote } = await import("@/app/jobs/actions");
  await sendQuote({
    jobId: "00000000-0000-4000-8000-000000000001",
    quoteId: "00000000-0000-4000-8000-000000000002",
    customer: { name: "Luca Feser", email: "luca@example.co.uk", smsOptOut: false },
    channels: { email: true, sms: false },
    ...(confirmZeroTotal === undefined ? {} : { confirmZeroTotal }),
  });
};

describe("markSent stamps what the customer was told", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("writes sent_total alongside the status flip", async () => {
    await runSend(114);

    const flip = quoteUpdates.find((u) => u.status === "sent");
    expect(flip, "no update flipped the quote to sent").toBeDefined();
    expect(
      flip?.sent_total,
      "the quote was marked sent without recording what was delivered — the " +
        "disclosure notice has nothing to compare against",
    ).toBe(114);
  });

  it("records the same figure the customer's message carried", async () => {
    // The point of stamping from the in-scope `quote.total` rather than
    // re-reading: a second read could observe a value the message never used,
    // and then the notice would disclose a divergence that never reached
    // anyone — or miss one that did.
    await runSend(114);

    const flip = quoteUpdates.find((u) => u.status === "sent");
    expect(messagedAmount).toBe(114);
    expect(flip?.sent_total).toBe(messagedAmount);
  });

  it("stamps a zero total rather than leaving it null", async () => {
    // 0 is a real delivered figure and must be distinguishable from "never
    // sent". A truthiness check here would collapse the two and silently
    // disable disclosure for every zero-total quote.
    // A zero total is a confirmation, not a block (see send-quote-guards) —
    // confirm it so this test exercises the stamp rather than that guard.
    await runSend(0, true);

    const flip = quoteUpdates.find((u) => u.status === "sent");
    expect(flip?.sent_total).toBe(0);
    expect(flip?.sent_total).not.toBeNull();
  });
});
