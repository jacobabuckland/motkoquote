// A stated fixed price must reach the quote, and must be noticed when it does
// not.
//
// Production carried the proof and still does: a quote whose SoW said
// pricing.fixed_amount = 5000 and whose single works line read £5.00 — sent
// unguarded and ACCEPTED at £6.00 gross, three orders of magnitude out.
//
// The mechanism was mundane. Switching to fixed with no figure typed seeds
// fixed_amount from the calculated subtotal (actions.ts), so quote and SoW
// agreed at 5000. The works line was then edited directly, and
// updateQuoteLineItems wrote line_items_json and total while never touching
// sow_json. Nothing anywhere compared the two.
//
// Separately, pricingSchema.mode carried .default("calculated"), so a delta
// that recorded the price but omitted the mode was silent in BOTH directions:
// applyPricingMode never used the amount, and isDurationSlotAnswered treats
// "calculated" as answered, so the wrap detour never re-asked either.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasStatedPriceMismatchFlag,
  reconcileStatedPrice,
  withStatedPriceFlag,
  STATED_PRICE_MISMATCH_PREFIX,
} from "@/lib/stated-price-guard";
import {
  EMPTY_SOW_STATE,
  mergeSowDelta,
  resolvePricingMode,
  resolvePricingModeFromDelta,
  getUnansweredChecklistQuestions,
} from "@/lib/schemas/sow";
import { applyPricingMode } from "@/lib/pricing-mode";
import { computeQuoteTotals } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem =>
  ({
    description: "Works — see Scope of work",
    category: "other",
    quantity: 1,
    unit: "job",
    unit_price: 0,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    ...over,
  }) as LineItem;

const fixedSow = (amount: number | null) => ({
  pricing: { mode: "fixed" as const, fixed_amount: amount },
});

describe("reconcileStatedPrice", () => {
  it("catches the live production row: £5,000 stated, £5.00 priced", () => {
    const flag = reconcileStatedPrice(fixedSow(5000), [
      line({ description: "Rewire works — see Scope of work", unit_price: 5 }),
    ]);

    expect(flag).not.toBeNull();
    // Both figures must appear: the whole value of the flag is that the
    // contractor sees WHICH two numbers disagree.
    expect(flag).toContain("£5000.00");
    expect(flag).toContain("£5.00");
  });

  it("says nothing when the priced lines match the stated price", () => {
    expect(reconcileStatedPrice(fixedSow(20), [line({ unit_price: 20 })])).toBeNull();
  });

  it("ignores provisional sums, which price separately by design", () => {
    // A fixed price covers the defined works; provisional sums remain editable
    // and are carried through unchanged by applyPricingMode. Counting them
    // would fire on every correctly-built fixed quote that has one.
    const flag = reconcileStatedPrice(fixedSow(2000), [
      line({ unit_price: 2000 }),
      line({ description: "Soil stack", unit_price: 450, provisional: true }),
    ]);

    expect(flag).toBeNull();
  });

  it("is silent for days and calculated — there is no stated total to honour", () => {
    for (const mode of ["days", "calculated"] as const) {
      expect(
        reconcileStatedPrice({ pricing: { mode, fixed_amount: 5000 } }, [
          line({ unit_price: 5 }),
        ]),
      ).toBeNull();
    }
  });

  it("is silent on a legacy job whose pricing was never set", () => {
    // pricing: null is the pre-Task B shape and must not change behaviour.
    // Two such rows are live in production and are correct today.
    expect(reconcileStatedPrice({ pricing: null }, [line({ unit_price: 5 })])).toBeNull();
    expect(reconcileStatedPrice(null, [line({ unit_price: 5 })])).toBeNull();
  });

  it("tolerates a penny of rounding, and no more", () => {
    expect(reconcileStatedPrice(fixedSow(20), [line({ unit_price: 20.01 })])).toBeNull();
    expect(reconcileStatedPrice(fixedSow(20), [line({ unit_price: 20.02 })])).not.toBeNull();
  });

  it("sums every non-provisional line, not just the first", () => {
    expect(
      reconcileStatedPrice(fixedSow(300), [
        line({ unit_price: 100 }),
        line({ unit_price: 200 }),
      ]),
    ).toBeNull();
  });
});

// PRICE-4: Per-amount reconciliation extends the existing guard
describe("per-amount reconciliation (PRICE-4)", () => {
  const sowWithStatedPrices = (
    amounts: Array<{ amount: number; item?: string }>,
    fixedAmount?: number,
  ) => ({
    pricing: {
      mode: "fixed" as const,
      fixed_amount: fixedAmount ?? amounts.reduce((sum, a) => sum + a.amount, 0),
    },
    stated_prices: amounts.map((a) => ({
      amount: Math.round(a.amount * 100), // Convert to pence
      item: a.item ?? "item",
      transcript_span: "",
      superseded_by: null,
      qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
      refused: false,
    })),
  });

  it("blocks when a line has no provenance", () => {
    const result = reconcileStatedPrice(
      sowWithStatedPrices([{ amount: 100 }]),
      [line({ unit_price: 100 })], // No provenance field
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Unsourced line");
  });

  it("passes when all lines have provenance", () => {
    const result = reconcileStatedPrice(
      sowWithStatedPrices([{ amount: 100 }]),
      [line({ unit_price: 100, provenance: { source: "transcript" } })],
    );
    expect(result).toBeNull();
  });

  it("blocks when a stated amount has no matching line", () => {
    // Use explicit fixed_amount=100 to match the line total, so the fixed-amount
    // check passes and the per-amount check can detect the mismatch
    const result = reconcileStatedPrice(
      sowWithStatedPrices([{ amount: 500, item: "Rewire" }], 100),
      [line({ unit_price: 100, provenance: { source: "transcript" } })],
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Amount mismatch");
    expect(result).toContain("£500.00");
    expect(result).toContain("Rewire");
  });

  it("blocks when a stated amount appears on multiple lines", () => {
    // Use explicit fixed_amount=200 to match the total of both lines, so the
    // fixed-amount check passes and the per-amount check can detect the duplicate
    const result = reconcileStatedPrice(
      sowWithStatedPrices([{ amount: 100 }], 200),
      [
        line({ unit_price: 100, provenance: { source: "transcript" } }),
        line({ description: "Another line", unit_price: 100, provenance: { source: "transcript" } }),
      ],
    );
    expect(result).not.toBeNull();
    expect(result).toContain("Duplicate amount");
    expect(result).toContain("2 lines");
  });

  it("compares against line total, not unit_price, for quantity > 1", () => {
    // Stated £170 should match line total of 2 × £85, not the £85 unit price
    const result = reconcileStatedPrice(
      sowWithStatedPrices([{ amount: 170, item: "Sockets" }]),
      [
        line({
          description: "Sockets",
          quantity: 2,
          unit_price: 85,
          provenance: { source: "transcript" },
        }),
      ],
    );
    expect(result).toBeNull();
  });

  it("ignores superseded stated prices", () => {
    // The old (superseded) price was £50, the new price is £100
    // We have a line at £50 which matches ONLY the superseded price
    // This should fail because the superseded price is ignored
    const sow = {
      pricing: { mode: "fixed" as const, fixed_amount: 50 },
      stated_prices: [
        {
          amount: 5000, // £50 - superseded
          item: "Old price",
          transcript_span: "",
          superseded_by: 1,
          qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
          refused: false,
        },
        {
          amount: 10000, // £100 - active
          item: "New price",
          transcript_span: "",
          superseded_by: null,
          qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
          refused: false,
        },
      ],
    };
    const result = reconcileStatedPrice(sow, [
      line({ unit_price: 50, provenance: { source: "transcript" } }),
    ]);
    expect(result).not.toBeNull();
    // Should fail looking for £100 (the non-superseded price), not £50
    expect(result).toContain("£100.00");
  });

  it("ignores excluded and already-paid stated prices", () => {
    // We have excluded (£50), already-paid (£30), and active (£75) stated prices
    // The line is £50, which matches ONLY the excluded price
    // This should fail because excluded/already-paid prices are ignored
    const sow = {
      pricing: { mode: "fixed" as const, fixed_amount: 50 },
      stated_prices: [
        {
          amount: 5000, // £50 - excluded
          item: "Excluded",
          transcript_span: "",
          superseded_by: null,
          qualifiers: { each: false, fitted: false, excluded: true, already_paid: false },
          refused: false,
        },
        {
          amount: 3000, // £30 - already paid
          item: "Already paid",
          transcript_span: "",
          superseded_by: null,
          qualifiers: { each: false, fitted: false, excluded: false, already_paid: true },
          refused: false,
        },
        {
          amount: 7500, // £75 - active
          item: "Active",
          transcript_span: "",
          superseded_by: null,
          qualifiers: { each: false, fitted: false, excluded: false, already_paid: false },
          refused: false,
        },
      ],
    };
    const result = reconcileStatedPrice(sow, [
      line({ unit_price: 50, provenance: { source: "transcript" } }),
    ]);
    expect(result).not.toBeNull();
    // Should fail looking for £75 (the only active price), not £50 or £30
    expect(result).toContain("£75.00");
  });

  it("does not fire when there are no stated_prices", () => {
    const result = reconcileStatedPrice(
      { pricing: { mode: "fixed", fixed_amount: 100 } },
      [line({ unit_price: 100 })], // No provenance, but no stated_prices either
    );
    // Legacy quote — per-amount check does not fire
    expect(result).toBeNull();
  });

  it("collects multiple failures rather than returning the first", () => {
    // Use explicit fixed_amount=125 to match the line total (50+75), so the
    // fixed-amount check passes and the per-amount check can run
    const result = reconcileStatedPrice(
      sowWithStatedPrices(
        [
          { amount: 100, item: "Item A" },
          { amount: 200, item: "Item B" },
        ],
        125,
      ),
      [
        line({ description: "Line 1", unit_price: 50 }), // Unsourced
        line({ description: "Line 2", unit_price: 75 }), // Unsourced
      ],
    );
    expect(result).not.toBeNull();
    // Should mention multiple unsourced lines
    expect(result).toContain("Line 1");
    expect(result).toContain("Line 2");
    // Should also mention the amount mismatches
    expect(result).toContain("£100.00");
    expect(result).toContain("£200.00");
  });
});

describe("withStatedPriceFlag", () => {
  it("adds the flag, and the predicate finds it", () => {
    const flags = withStatedPriceFlag([], fixedSow(5000), [line({ unit_price: 5 })]);

    expect(hasStatedPriceMismatchFlag(flags)).toBe(true);
  });

  it("REPLACES a stale flag once the figures are corrected", () => {
    // A mismatch left standing after the contractor fixed it is worse than no
    // flag at all: it trains them to ignore the one warning that matters.
    const stale = withStatedPriceFlag([], fixedSow(5000), [line({ unit_price: 5 })]);
    expect(hasStatedPriceMismatchFlag(stale)).toBe(true);

    const corrected = withStatedPriceFlag(stale, fixedSow(5000), [
      line({ unit_price: 5000 }),
    ]);

    expect(hasStatedPriceMismatchFlag(corrected)).toBe(false);
    expect(corrected.filter((f) => f.startsWith(STATED_PRICE_MISMATCH_PREFIX))).toHaveLength(0);
  });

  it("never accumulates duplicates across repeated saves", () => {
    let flags = withStatedPriceFlag([], fixedSow(5000), [line({ unit_price: 5 })]);
    flags = withStatedPriceFlag(flags, fixedSow(5000), [line({ unit_price: 5 })]);
    flags = withStatedPriceFlag(flags, fixedSow(5000), [line({ unit_price: 5 })]);

    expect(flags.filter((f) => f.startsWith(STATED_PRICE_MISMATCH_PREFIX))).toHaveLength(1);
  });

  it("leaves unrelated flags alone", () => {
    const flags = withStatedPriceFlag(["Check the access notes"], fixedSow(20), [
      line({ unit_price: 20 }),
    ]);

    expect(flags).toEqual(["Check the access notes"]);
  });
});

describe("a stated price with no mode is a fixed price", () => {
  it("resolves the mode from the evidence", () => {
    expect(resolvePricingModeFromDelta({ fixed_amount: 20 })).toBe("fixed");
    expect(resolvePricingModeFromDelta({ mode: "days", fixed_amount: 20 })).toBe("days");
    expect(resolvePricingModeFromDelta({})).toBeUndefined();
  });

  it("carries a mode-less £20 all the way to a £24 quote", () => {
    const merged = mergeSowDelta(EMPTY_SOW_STATE, { pricing: { fixed_amount: 20 } });

    expect(resolvePricingMode(merged)).toBe("fixed");

    const items = applyPricingMode([line({ unit_price: 95 })], merged, true);
    expect(items).toHaveLength(1);
    expect(items[0].unit_price).toBe(20);
    expect(computeQuoteTotals(items, true).total).toBe(24);
  });

  it("an explicit mode always beats the inference", () => {
    const merged = mergeSowDelta(EMPTY_SOW_STATE, {
      pricing: { mode: "days", fixed_amount: 20 },
    });

    expect(resolvePricingMode(merged)).toBe("days");
  });

  it("a delta with neither leaves pricing untouched, so the slot re-asks", () => {
    // The old default manufactured an answer here and closed the question.
    const merged = mergeSowDelta(EMPTY_SOW_STATE, { pricing: {} });

    expect(resolvePricingMode(merged)).toBeNull();
    expect(getUnansweredChecklistQuestions(merged)).toContain("duration");
  });

  it("still leaves the slot open for a mode with no companion value", () => {
    const merged = mergeSowDelta(EMPTY_SOW_STATE, { pricing: { mode: "fixed" } });

    expect(resolvePricingMode(merged)).toBe("fixed");
    expect(getUnansweredChecklistQuestions(merged)).toContain("duration");
  });
});

// The wiring. The guard being correct proves nothing if no writer calls it —
// that is exactly how two inert mic-gate fixes shipped green on #369.
const h = vi.hoisted(() => {
  const quoteUpdates: Array<Record<string, unknown>> = [];
  const quoteContext = {
    status: "draft",
    contractor_flags_json: [] as string[],
    job: {
      extracted_json: null,
      sow_json: { pricing: { mode: "fixed", fixed_amount: 5000 } },
      contractor: { id: "c-1", vat_registered: true },
    },
  };

  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => b;
      b.update = (payload: Record<string, unknown>) => {
        if (table === "quotes") quoteUpdates.push(payload);
        return b;
      };
      b.single = () => Promise.resolve({ data: quoteContext, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [{ id: "q-1" }], error: null });
      return b;
    },
  };

  return { client, quoteUpdates };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/knowledge", () => ({
  syncQuoteKnowledge: vi.fn(async () => {}),
  findSimilarPastJobs: vi.fn(async () => []),
}));
vi.mock("@/lib/materials", () => ({
  rememberMaterialPrices: vi.fn(async () => {}),
  findKnownMaterialPrices: vi.fn(async () => []),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("updateQuoteLineItems reconciles — the writer that caused the live row", () => {
  beforeEach(() => {
    h.quoteUpdates.length = 0;
  });

  it("flags an edit that walks the works line away from the stated price", async () => {
    const { updateQuoteLineItems } = await import("@/app/jobs/actions");

    // Exactly what happened: sow says 5000, the works line is edited to 5.
    await updateQuoteLineItems({
      jobId: "00000000-0000-4000-8000-000000000001",
      quoteId: "00000000-0000-4000-8000-000000000002",
      lineItems: [line({ description: "Rewire works — see Scope of work", unit_price: 5 })],
    });

    const write = h.quoteUpdates.at(-1);
    expect(write).toBeDefined();
    expect(write?.total).toBe(6);
    // On main this key is absent entirely: the writer had no sight of sow_json.
    expect(hasStatedPriceMismatchFlag(write?.contractor_flags_json as string[])).toBe(true);
  });
});
