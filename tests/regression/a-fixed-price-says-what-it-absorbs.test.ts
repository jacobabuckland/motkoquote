import { describe, expect, it } from "vitest";
import {
  FIXED_PRICE_ABSORBED_PREFIX,
  absorbedByFixedPrice,
  applyPricingMode,
} from "@/lib/pricing-mode";
import { withStatedPriceFlag, isReconciliationFlag } from "@/lib/stated-price-guard";
import { computeQuoteTotals, sumLines } from "@/lib/quote-math";
import { chargedLines } from "@/lib/quote-lines";
import type { LineItem } from "@/lib/schemas/job";

/**
 * A fixed price may absorb priced work, but it may not do it in silence.
 *
 * The collapse is correct: the contractor gave one number for the whole job, so
 * the quote carries one line at that number. The defect was that the guard which
 * would have caught the divergence runs AFTER it. reconcileStatedPrice compares
 * `pricing.fixed_amount` against the ACTIVE lines, and after a collapse those
 * lines are the works line at fixed_amount — it compares £1,800 against £1,800,
 * agrees with itself, and reports nothing.
 *
 * Quote 46e3d510, reproduced below to the penny: four drafted lines totalling
 * £2,355.98 became one line at £1,800, VAT was charged on £1,800, and it was
 * ACCEPTED at £2,160. £555.98 of priced work left the document with nothing
 * said. The contractor had stated £1,800 labour AND £400 materials — two figures
 * for a field that holds one — so the absorbed value was not a discount anyone
 * chose.
 *
 * WHAT THIS DOES NOT DO: block, or change a price. A contractor discounting
 * their own quote is doing something legitimate and the product honours it. This
 * only refuses to let the difference go unmentioned.
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

/** The real drafted breakdown from quote 46e3d510. Sums to £2,355.98. */
const drafted46e3d510: LineItem[] = [
  line({ description: "Plastering labour", category: "labour", unit_price: 1099.98 }),
  line({ description: "Finishing plaster (multi-finish)", quantity: 15, unit_price: 60 }),
  line({ description: "PVA bonding agent", quantity: 3, unit_price: 72 }),
  line({ description: "Scrim tape and consumables", unit_price: 140 }),
];

const fixedAt = (amount: number) => ({
  pricing: { mode: "fixed" as const, fixed_amount: amount },
});

describe("quote 46e3d510, reproduced", () => {
  it("the breakdown really does come to £2,355.98", () => {
    expect(sumLines(drafted46e3d510)).toBe(2355.98);
  });

  it("the collapse still deletes it, and the total is still £2,160", () => {
    // Unchanged behaviour, pinned so the fix is visibly about SPEECH, not money.
    const active = applyPricingMode(drafted46e3d510, {
      ...fixedAt(1800),
      job_type: "plastering",
    });
    expect(active).toHaveLength(1);
    expect(sumLines(chargedLines(active))).toBe(1800);
    expect(computeQuoteTotals(active, true).total).toBe(2160);
  });

  it("the reconciler alone still sees nothing wrong — it compares too late", () => {
    // The precise reason this needed its own guard. Given the ACTIVE lines, the
    // stated figure and the priced lines are the same number.
    const active = applyPricingMode(drafted46e3d510, {
      ...fixedAt(1800),
      job_type: "plastering",
    });
    const flags = withStatedPriceFlag([], fixedAt(1800), active);
    expect(flags).toEqual([]);
  });

  it("but the absorbed value is now stated, to the penny", () => {
    const flag = absorbedByFixedPrice(fixedAt(1800), drafted46e3d510);
    expect(flag).toContain("£1800.00");
    expect(flag).toContain("£2355.98");
    expect(flag).toContain("£555.98");
  });

  it("and reaches the contractor when the breakdown is passed", () => {
    const active = applyPricingMode(drafted46e3d510, {
      ...fixedAt(1800),
      job_type: "plastering",
    });
    const flags = withStatedPriceFlag([], fixedAt(1800), active, drafted46e3d510);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("£555.98");
  });
});

describe("when it stays quiet", () => {
  it("says nothing when the fixed price matches the priced work", () => {
    expect(absorbedByFixedPrice(fixedAt(2355.98), drafted46e3d510)).toBeNull();
  });

  it("says nothing when the contractor prices ABOVE their own breakdown", () => {
    // They have added something the draft did not know about. Theirs to do.
    expect(absorbedByFixedPrice(fixedAt(3000), drafted46e3d510)).toBeNull();
  });

  it("says nothing outside fixed mode", () => {
    expect(
      absorbedByFixedPrice({ pricing: { mode: "days", fixed_amount: null } }, drafted46e3d510),
    ).toBeNull();
    expect(absorbedByFixedPrice({ pricing: null }, drafted46e3d510)).toBeNull();
  });

  it("says nothing when there is no breakdown to compare against", () => {
    expect(absorbedByFixedPrice(fixedAt(1800), [])).toBeNull();
  });

  it("ignores provisional sums on both sides", () => {
    // A provisional sum carries through the collapse untouched, so it is not
    // absorbed by anything and must not inflate the difference.
    const withProvisional = [
      ...drafted46e3d510,
      line({ description: "Provisional sum", unit_price: 400, provisional: true }),
    ];
    const flag = absorbedByFixedPrice(fixedAt(2355.98), withProvisional);
    expect(flag).toBeNull();
  });
});

describe("the flag behaves like the rest of its family", () => {
  it("is recognised as a reconciliation flag, so it is replaced not accumulated", () => {
    // Its prefix must be in RECONCILIATION_FLAG_PREFIXES. A producer whose
    // prefix is missing appends a fresh copy on every save — quote b3112196 on
    // production carried eight flags, one string repeated twice and another
    // three times, which is how a contractor learns to stop reading them.
    const flag = absorbedByFixedPrice(fixedAt(1800), drafted46e3d510)!;
    expect(isReconciliationFlag(flag)).toBe(true);
    expect(flag.startsWith(FIXED_PRICE_ABSORBED_PREFIX)).toBe(true);
  });

  it("replaces a stale copy of itself rather than adding a second", () => {
    const stale = absorbedByFixedPrice(fixedAt(1500), drafted46e3d510)!;
    const active = applyPricingMode(drafted46e3d510, {
      ...fixedAt(1800),
      job_type: "plastering",
    });

    const flags = withStatedPriceFlag([stale], fixedAt(1800), active, drafted46e3d510);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain("£555.98");
    expect(flags[0]).not.toContain("£855.98");
  });

  it("clears itself once the contractor corrects the fixed price", () => {
    const stale = absorbedByFixedPrice(fixedAt(1800), drafted46e3d510)!;
    const corrected = fixedAt(2355.98);
    const active = applyPricingMode(drafted46e3d510, {
      ...corrected,
      job_type: "plastering",
    });

    const flags = withStatedPriceFlag([stale], corrected, active, drafted46e3d510);
    expect(flags).toEqual([]);
  });

  it("leaves flags from outside the family alone", () => {
    const theirs = "Crew listed as 'me, Dan, and Liam' — confirm before issuing.";
    const active = applyPricingMode(drafted46e3d510, {
      ...fixedAt(1800),
      job_type: "plastering",
    });
    const flags = withStatedPriceFlag([theirs], fixedAt(1800), active, drafted46e3d510);
    expect(flags).toContain(theirs);
    expect(flags).toHaveLength(2);
  });
});
