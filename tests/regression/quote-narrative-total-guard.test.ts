// Regression: a quote went out whose Scope of work read "at a fixed price of
// £5,000" above a single priced line of £5.00 · VAT £1.00 · total £6.00. Two
// figures for the same job on one page, three orders of magnitude apart.
//
// The total is what the customer is asked to pay; the prose is what they think
// they agreed. Whichever way that dispute lands the trade loses, and the
// document is the evidence.
//
// This guard is a CONFIRMATION, never a block. A narrative may legitimately
// name a figure the priced total does not equal, and refusing to send would
// create a support problem that never arrives as a bug report — the same
// reasoning that shaped ZERO_TOTAL_CONFIRM_REQUIRED.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NARRATIVE_TOTAL_CONFIRM_REQUIRED,
  agreedPriceDisagrees,
  narrativeAmounts,
  narrativeConfirmMessage,
  narrativeExceedsSubtotal,
  parseNarrativeConfirm,
} from "@/lib/quote-send-guards";
import type { LineItem } from "@/lib/schemas/job";

describe("reading amounts out of a scope narrative", () => {
  it("reads a comma-grouped thousand as a thousand, not as five pounds", () => {
    // The defect in miniature. A naive /£([\d.]+)/ stops at the comma and
    // yields 5 from "£5,000" — it would read the divergent narrative as
    // agreeing with the £5.00 line and stay silent on the one quote it exists
    // to catch.
    expect(narrativeAmounts("at a fixed price of £5,000")).toEqual([5000]);
  });

  it("reads an ungrouped thousand as a thousand too", () => {
    expect(narrativeAmounts("all in for £5000")).toEqual([5000]);
  });

  it("reads pence", () => {
    expect(narrativeAmounts("a call-out at £5.00")).toEqual([5]);
  });

  it("reads every amount in the order written", () => {
    expect(
      narrativeAmounts("£350 a day over four days, materials around £1,200"),
    ).toEqual([350, 1200]);
  });

  it("finds nothing in prose that names no money", () => {
    // 5 sockets and 5 days are not five pounds. Matching bare digits would
    // fire this guard on ordinary quotes, so only the £ sign counts.
    expect(narrativeAmounts("5 sockets across 5 days, 2 circuits")).toEqual([]);
    expect(narrativeAmounts(null)).toEqual([]);
    expect(narrativeAmounts(undefined)).toEqual([]);
    expect(narrativeAmounts("")).toEqual([]);
  });
});

describe("narrativeExceedsSubtotal", () => {
  it("fires on the reported quote: £5,000 in prose, £5.00 priced", () => {
    const check = narrativeExceedsSubtotal("at a fixed price of £5,000", 5);
    expect(check.confirmRequired).toBe(true);
    expect(check.statedAmount).toBe(5000);
    expect(check.subtotal).toBe(5);
  });

  it("stays silent when the narrative figure is the priced figure", () => {
    expect(
      narrativeExceedsSubtotal("at a fixed price of £5,000", 5000)
        .confirmRequired,
    ).toBe(false);
  });

  it("compares against the NET subtotal, so VAT is not a divergence", () => {
    // A VAT-registered £5,000 quote totals £6,000. The narrative states the net
    // figure. Comparing against the VAT-inclusive total would fire on every
    // VAT-registered quote that names its price in prose — which is most of
    // them — and the guard would be turned off within a week.
    expect(
      narrativeExceedsSubtotal("the works come to £5,000 plus VAT", 5000)
        .confirmRequired,
    ).toBe(false);
  });

  it("never fires on absence", () => {
    // The single most important property. A narrative that names no money, or
    // a quote with no scope section at all, must send exactly as it does today.
    expect(narrativeExceedsSubtotal("Full rewire of a three-bed semi.", 1700).confirmRequired).toBe(false);
    expect(narrativeExceedsSubtotal(null, 1700).confirmRequired).toBe(false);
    expect(narrativeExceedsSubtotal(undefined, 0).confirmRequired).toBe(false);
  });

  it("ignores figures BELOW the subtotal — sub-parts are the ordinary case", () => {
    // A day rate, a provisional sum, a deposit and a materials allowance are
    // all smaller than the job by definition. Flagging them would bury the real
    // divergence in noise, and a sub-part price can never exceed the job total
    // — so "the biggest number in the prose is bigger than what we're charging"
    // is the shape that is actually wrong.
    const narrative =
      "Labour at £340 a day over five days. A provisional sum of £1,200 is " +
      "carried for the consumer unit. £500 payable on start.";
    expect(narrativeExceedsSubtotal(narrative, 5000).confirmRequired).toBe(false);
  });

  it("fires on the largest figure when several are stated", () => {
    const check = narrativeExceedsSubtotal(
      "£340 a day, and a fixed price of £8,000 for the whole job",
      5000,
    );
    expect(check.confirmRequired).toBe(true);
    expect(check.statedAmount).toBe(8000);
  });

  it("treats a penny of drift as agreement, not divergence", () => {
    expect(narrativeExceedsSubtotal("£1,700.01", 1700).confirmRequired).toBe(false);
    expect(narrativeExceedsSubtotal("£1,700.02", 1700).confirmRequired).toBe(true);
  });
});

describe("the two stored price fields disagreeing with each other", () => {
  // agreed_costs.fixed_price and pricing.fixed_amount both hold "the agreed
  // price". Only the second reaches the customer, and applyPricingMode's
  // parameter type narrows the first out entirely — so the function deciding
  // what a customer will be held to cannot see the other stored figure for the
  // same job.
  it("fires when they differ by more than a penny", () => {
    expect(agreedPriceDisagrees(5000, 5)).toBe(true);
  });

  it("stays silent when they agree", () => {
    expect(agreedPriceDisagrees(5000, 5000)).toBe(false);
    expect(agreedPriceDisagrees(5000, 5000.005)).toBe(false);
  });

  it("stays silent when either is absent — the common case", () => {
    // Most jobs populate one field or neither. A job with nothing to compare
    // has nothing to disagree with, and must not be interrupted.
    expect(agreedPriceDisagrees(null, 5000)).toBe(false);
    expect(agreedPriceDisagrees(5000, null)).toBe(false);
    expect(agreedPriceDisagrees(undefined, undefined)).toBe(false);
  });
});

describe("carrying the figures back to the client", () => {
  // A bare "these don't match" is not worth interrupting a send for: the value
  // of the question is that the contractor sees BOTH numbers and can tell which
  // is wrong. The editor never reads the scope narrative, so they travel on the
  // thrown message.
  it("round-trips both figures", () => {
    expect(parseNarrativeConfirm(narrativeConfirmMessage(5000, 5))).toEqual({
      stated: 5000,
      subtotal: 5,
    });
  });

  it("round-trips a field-vs-field divergence, which has no narrative figure", () => {
    expect(parseNarrativeConfirm(narrativeConfirmMessage(null, 5))).toEqual({
      stated: null,
      subtotal: 5,
    });
  });

  it("recognises a bare sentinel that lost its figures", () => {
    // An older client or a rethrow that dropped the tail must still be read as
    // the confirmation question, not surfaced to the contractor as a raw error
    // string reading "NARRATIVE_TOTAL_CONFIRM_REQUIRED".
    expect(parseNarrativeConfirm(NARRATIVE_TOTAL_CONFIRM_REQUIRED)).toEqual({
      stated: null,
      subtotal: null,
    });
  });

  it("returns null for any other error, so it doubles as the test", () => {
    expect(parseNarrativeConfirm("Quote not found")).toBeNull();
    expect(parseNarrativeConfirm("ZERO_TOTAL_CONFIRM_REQUIRED")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// End to end through sendQuote, so the guard is observed to actually gate a
// send rather than merely to return true in isolation.
// ---------------------------------------------------------------------------

const priced: LineItem = {
  description: "Rewire works — see Scope of work",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 5,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

type SowShape = {
  overview_narrative?: string | null;
  agreed_costs?: { fixed_price?: number | null } | null;
  pricing?: { mode?: string; fixed_amount?: number | null } | null;
};

let emailsSent = 0;

const runSend = async (
  opts: {
    sow: SowShape | null;
    lineItems?: LineItem[];
    total?: number;
    confirmNarrativeMismatch?: boolean;
  },
) => {
  emailsSent = 0;
  vi.resetModules();

  const quoteRow = {
    total: opts.total ?? 6,
    line_items_json: opts.lineItems ?? [priced],
    drafted_line_items_json: null,
    contractor_flags_json: [],
  };

  const rowFor = (table: string): unknown => {
    if (table === "jobs") {
      return {
        contractor_id: "contractor-1",
        customer_id: "customer-1",
        sow_json: opts.sow,
        contractor: { company_name: "Buckland Electrical Ltd" },
      };
    }
    if (table === "quotes") return quoteRow;
    if (table === "customers") return { id: "customer-1" };
    return null;
  };

  const chain = (table: string): Record<string, unknown> => ({
    select: () => chain(table),
    eq: () => chain(table),
    order: () => chain(table),
    limit: () => chain(table),
    single: async () => ({ data: rowFor(table), error: null }),
    maybeSingle: async () => ({ data: rowFor(table), error: null }),
    insert: () => ({
      select: () => ({ single: async () => ({ data: { id: "x" }, error: null }) }),
    }),
    update: () => chain(table),
  });

  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => chain(table),
    }),
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
    ...(opts.confirmNarrativeMismatch === undefined
      ? {}
      : { confirmNarrativeMismatch: opts.confirmNarrativeMismatch }),
  });
};

describe("sendQuote — the narrative/total confirmation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("asks before sending the reported quote, and does not block it", async () => {
    const sow: SowShape = {
      overview_narrative:
        "Full rewire of the property, carried out at a fixed price of £5,000 " +
        "with the customer in occupation throughout.",
      pricing: { mode: "fixed", fixed_amount: 5 },
      agreed_costs: null,
    };

    // First attempt: the question, and nothing left the building.
    await expect(runSend({ sow })).rejects.toThrow(NARRATIVE_TOTAL_CONFIRM_REQUIRED);
    expect(emailsSent, "a quote was sent while the question was still open").toBe(0);

    // Answered: it goes. The guard asks once; it never refuses.
    await expect(
      runSend({ sow, confirmNarrativeMismatch: true }),
    ).resolves.toBeDefined();
    expect(emailsSent).toBe(1);
  });

  it("carries both figures on the thrown message", async () => {
    const sow: SowShape = {
      overview_narrative: "at a fixed price of £5,000",
      pricing: { mode: "fixed", fixed_amount: 5 },
    };

    const error = await runSend({ sow }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(parseNarrativeConfirm((error as Error).message)).toEqual({
      stated: 5000,
      subtotal: 5,
    });
  });

  it("sends silently when the narrative figure is the priced figure", async () => {
    await expect(
      runSend({
        sow: {
          overview_narrative: "Full rewire at a fixed price of £5,000.",
          pricing: { mode: "fixed", fixed_amount: 5000 },
        },
        lineItems: [{ ...priced, unit_price: 5000 }],
        total: 6000,
      }),
    ).resolves.toBeDefined();
    expect(emailsSent).toBe(1);
  });

  it("sends silently when the narrative names no money at all", async () => {
    await expect(
      runSend({
        sow: {
          overview_narrative:
            "Full rewire of a three-bed semi over four days, property occupied.",
        },
      }),
    ).resolves.toBeDefined();
    expect(emailsSent).toBe(1);
  });

  it("sends silently when there is no scope at all", async () => {
    // The path every existing quote takes. If this fires, the guard has broken
    // sending for jobs that have nothing wrong with them.
    await expect(runSend({ sow: null })).resolves.toBeDefined();
    expect(emailsSent).toBe(1);
  });

  it("asks when the two stored price fields disagree, even with no narrative", async () => {
    await expect(
      runSend({
        sow: {
          overview_narrative: null,
          agreed_costs: { fixed_price: 5000 },
          pricing: { mode: "fixed", fixed_amount: 5 },
        },
      }),
    ).rejects.toThrow(NARRATIVE_TOTAL_CONFIRM_REQUIRED);
    expect(emailsSent).toBe(0);
  });
});
