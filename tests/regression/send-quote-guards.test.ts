import { beforeEach, describe, expect, it, vi } from "vitest";
import { UNRESOLVED_RATE_FLAG } from "@/lib/compile-draft";
import { ZERO_TOTAL_CONFIRM_REQUIRED } from "@/lib/quote-send-guards";
import type { LineItem } from "@/lib/schemas/job";

// Two situations that must NOT be merged: an unresolved rate is a missing
// figure and blocks; a zero total is a deliberate figure and only confirms.

const priced: LineItem = {
  description: "Full rewire",
  category: "labour",
  quantity: 5,
  unit: "day",
  unit_price: 340,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  people: [{ label: "Owner", days: 5, day_rate: 340 }],
};

type QuoteRow = {
  total: number;
  line_items_json: LineItem[];
  drafted_line_items_json: LineItem[] | null;
  contractor_flags_json: string[] | null;
};

// Records what actually happened downstream of the guards, so "it sent" is
// observed rather than inferred from the absence of a throw.
let emailsSent = 0;

const runSend = async (quote: QuoteRow, confirmZeroTotal?: boolean) => {
  emailsSent = 0;
  vi.resetModules();

  const chain = (table: string): Record<string, unknown> => ({
    select: () => chain(table),
    eq: () => chain(table),
    order: () => chain(table),
    limit: () => chain(table),
    single: async () => ({ data: rowFor(table), error: null }),
    maybeSingle: async () => ({ data: rowFor(table), error: null }),
    insert: () => ({ select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }) }),
    update: () => chain(table),
  });

  const rowFor = (table: string): unknown => {
    if (table === "jobs") {
      return {
        contractor_id: "contractor-1",
        customer_id: "customer-1",
        sow_json: null,
        contractor: { company_name: "Buckland Electrical Ltd" },
      };
    }
    if (table === "quotes") return quote;
    if (table === "customers") return { id: "customer-1" };
    return null;
  };

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chain(table),
    }),
  }));
  vi.doMock("@/lib/fee-runway", () => ({
    loadFeeRunway: async () => ({ canSendQuote: true }),
    FEE_RUNWAY_BLOCKED_MESSAGE: "blocked",
  }));
  vi.doMock("@/lib/email", () => ({
    sendQuoteEmail: async () => {
      emailsSent += 1;
      return { delivered: true };
    },
  }));
  vi.doMock("@/lib/sms", () => ({ sendQuoteSms: async () => ({ delivered: false }) }));
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
  return sendQuote({
    jobId: "00000000-0000-4000-8000-000000000001",
    quoteId: "00000000-0000-4000-8000-000000000002",
    customer: { name: "Luca Feser", email: "luca@example.co.uk", smsOptOut: false },
    channels: { email: true, sms: false },
    ...(confirmZeroTotal === undefined ? {} : { confirmZeroTotal }),
  });
};

describe("sendQuote guards", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("blocks a quote carrying the unresolved-rate flag, naming the rate", async () => {
    await expect(
      runSend({
        // Note the non-zero total: an unpriced line among priced ones still
        // sums to something. The guard is on the flag, never on the amount.
        total: 185,
        line_items_json: [priced],
        drafted_line_items_json: null,
        contractor_flags_json: [UNRESOLVED_RATE_FLAG],
      }),
    ).rejects.toThrow(/day rate/i);

    expect(emailsSent, "a blocked quote was still sent").toBe(0);
  });

  it("asks before sending a deliberately zeroed quote, and does not block it", async () => {
    const zeroQuote: QuoteRow = {
      total: 0,
      line_items_json: [{ ...priced, unit_price: 0, people: [{ label: "Owner", days: 1, day_rate: 0 }] }],
      drafted_line_items_json: null,
      contractor_flags_json: [],
    };

    // First attempt: the question, not a refusal.
    await expect(runSend(zeroQuote)).rejects.toThrow(ZERO_TOTAL_CONFIRM_REQUIRED);
    expect(emailsSent).toBe(0);

    // Confirmed: it goes.
    await expect(runSend(zeroQuote, true)).resolves.toBeDefined();
    expect(emailsSent).toBe(1);
  });

  it("leaves a normally priced quote alone — no prompt, no new failure", async () => {
    await expect(
      runSend({
        total: 1700,
        line_items_json: [priced],
        drafted_line_items_json: null,
        contractor_flags_json: [],
      }),
    ).resolves.toBeDefined();

    expect(emailsSent).toBe(1);
  });

  it("keeps the unresolved-rate block ahead of the zero-total question", async () => {
    // A quote that is BOTH unpriced and zero must report the cause the
    // contractor can act on, not ask them to confirm a zero they didn't choose.
    await expect(
      runSend({
        total: 0,
        line_items_json: [{ ...priced, unit_price: 0, unpriced: true }],
        drafted_line_items_json: null,
        contractor_flags_json: [UNRESOLVED_RATE_FLAG],
      }),
    ).rejects.toThrow(/day rate/i);
  });
});
