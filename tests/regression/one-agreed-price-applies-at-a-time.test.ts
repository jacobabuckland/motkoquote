import { describe, expect, it } from "vitest";
import { agreedFixedPriceInEffect, applyAgreedFixedPrice } from "@/lib/agreed-costs";
import { absorbedByFixedPrice, applyPricingMode } from "@/lib/pricing-mode";
import { sumLines } from "@/lib/quote-math";
import { definedWorksLines } from "@/lib/quote-lines";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

/**
 * Two fields hold a total for one job, and only one of them may act on a quote.
 *
 *   agreed_costs.fixed_price  "was anything already agreed with the customer?"
 *                             → scale the breakdown to land on the promised
 *                               figure, itemisation intact
 *   pricing.fixed_amount      "how do you want THIS priced?"
 *                             → collapse the defined works to one line at it
 *
 * Both are right on their own. They were CHAINED: scale to A, then throw the
 * scaled breakdown away and write one line at B. So the scaling never reached
 * the customer, and its only surviving effect was on the drafted baseline the
 * editor restores when the contractor leaves fixed mode.
 *
 * Quote 8c072bc2 on production carries three drafted lines scaled to £200 under
 * a single £200 works line. Switching it out of fixed mode hands back a
 * breakdown nobody priced.
 *
 * WHAT THIS DOES NOT CHANGE: what any customer is charged. In fixed mode the
 * active line is pricing.fixed_amount either way. Only the drafted baseline and
 * the contractor's flags move — which is the point, because both were lying.
 */

const line = (over: Partial<LineItem> & { description: string }): LineItem => ({
  category: "materials",
  quantity: 1,
  unit: "unit",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

/** A breakdown the engine priced at £500. */
const drafted: LineItem[] = [
  line({ description: "Plastering labour", category: "labour", unit_price: 300 }),
  line({ description: "Multi-finish", quantity: 5, unit_price: 30 }),
  line({ description: "Consumables", unit_price: 50 }),
];

const sow = (
  agreedFixedPrice: number | null,
  pricing: SowState["pricing"],
): Pick<SowState, "pricing" | "agreed_costs"> => ({
  pricing,
  agreed_costs: {
    day_rate: null,
    fixed_price: agreedFixedPrice,
    deposit_amount: null,
    notes: undefined,
  },
});

describe("which agreed price applies", () => {
  it("scales to the agreed figure when the contractor did NOT state a fixed price", () => {
    // The promised-figure case, unchanged: they told the customer £400 and want
    // an itemised quote under it.
    const state = sow(400, { mode: "calculated", fixed_amount: null });
    expect(agreedFixedPriceInEffect(state)).toBe(400);

    const calculated = applyAgreedFixedPrice(drafted, agreedFixedPriceInEffect(state));
    expect(sumLines(calculated)).toBe(400);
    expect(calculated).toHaveLength(3);
  });

  it("still scales in days mode, and when pricing never landed at all", () => {
    expect(agreedFixedPriceInEffect(sow(400, { mode: "days", fixed_amount: null }))).toBe(400);
    expect(agreedFixedPriceInEffect(sow(400, null))).toBe(400);
  });

  it("stands down in fixed mode — the contractor has restated the price", () => {
    const state = sow(400, { mode: "fixed", fixed_amount: 450 });
    expect(agreedFixedPriceInEffect(state)).toBeNull();
  });

  it("stands down in fixed mode even when the two figures AGREE", () => {
    // Quote 8c072bc2's shape. Agreement is not a reason to scale: the lines are
    // about to be replaced either way, so scaling only rewrites the baseline.
    expect(agreedFixedPriceInEffect(sow(200, { mode: "fixed", fixed_amount: 200 }))).toBeNull();
  });

  it("returns null when nothing was agreed", () => {
    expect(agreedFixedPriceInEffect(sow(null, { mode: "calculated", fixed_amount: null }))).toBeNull();
    expect(
      agreedFixedPriceInEffect({ pricing: null, agreed_costs: null }),
    ).toBeNull();
  });
});

describe("the drafted baseline is the engine's own pricing", () => {
  const state = sow(200, { mode: "fixed", fixed_amount: 200 });

  it("keeps the breakdown the engine priced, not one scaled to the other field", () => {
    const calculated = applyAgreedFixedPrice(drafted, agreedFixedPriceInEffect(state));
    expect(sumLines(calculated)).toBe(500);
    expect(calculated).toEqual(drafted);
  });

  it("charges the customer exactly what it charged before", () => {
    // The load-bearing assertion. This item may not move a price.
    const calculated = applyAgreedFixedPrice(drafted, agreedFixedPriceInEffect(state));
    const active = applyPricingMode(calculated, { ...state, job_type: "plastering" });
    expect(active).toHaveLength(1);
    expect(sumLines(active)).toBe(200);

    // And the chained ordering produced the identical charge, which is why the
    // corruption was invisible.
    const chained = applyAgreedFixedPrice(drafted, 200);
    const chainedActive = applyPricingMode(chained, { ...state, job_type: "plastering" });
    expect(sumLines(chainedActive)).toBe(sumLines(active));
  });
});

describe("the absorbed-work guard can see again", () => {
  it("reports the real priced work, not the other stated figure", () => {
    // Chained, definedWorks was scaled to agreed_costs.fixed_price, so the flag
    // named £450 as "the priced work" when £450 was simply the other field.
    const state = sow(450, { mode: "fixed", fixed_amount: 300 });
    const chained = applyAgreedFixedPrice(drafted, 450);
    expect(sumLines(definedWorksLines(chained))).toBe(450);
    expect(absorbedByFixedPrice(state, chained)).toContain("£450.00");

    // Ordered, it compares against the £500 the engine actually priced.
    const calculated = applyAgreedFixedPrice(drafted, agreedFixedPriceInEffect(state));
    const flag = absorbedByFixedPrice(state, calculated);
    expect(flag).toContain("£500.00");
    expect(flag).toContain("£200.00");
    expect(flag).not.toContain("£450.00");
  });

  it("stops being silenced when the two figures agree", () => {
    // The worse half: scaling made stated and definedWorks equal, so the guard
    // added to catch absorbed work fell silent on exactly the jobs carrying it.
    const state = sow(200, { mode: "fixed", fixed_amount: 200 });

    const chained = applyAgreedFixedPrice(drafted, 200);
    expect(absorbedByFixedPrice(state, chained)).toBeNull();

    const calculated = applyAgreedFixedPrice(drafted, agreedFixedPriceInEffect(state));
    expect(absorbedByFixedPrice(state, calculated)).toContain("£300.00");
  });
});
