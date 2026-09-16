// Quote 09F065E5 went out at £1,248 for a job the contractor priced at "£520
// plus VAT" — exactly double — and every internal check agreed with it.
//
// `applyPricingMode` collapses a fixed-price quote to one works line at the
// stated amount and KEEPS provisional sums, because a fixed price covers the
// defined works and not the allowance beside it. On this run the draft marked
// the defined works provisional AND priced it at the full £520, so it rode
// through beside the new works line:
//
//     General works — see Scope of work ........... £520.00
//     Consumer unit replacement – fixed price ..... £520.00   (provisional)
//     Waste removal ............................... £0.00     (provisional)
//
// Nothing caught it. reconcileStatedPrice compares the stated figure against the
// DEFINED works — provisionals excluded by design — so it read £520 against £520
// and agreed. The double-charge check skips provisional lines outright. The quote
// reconciled with itself while being twice the agreed price.
//
// The same script produced a correct £624 quote on another run (job 31E0797F,
// whose provisional line carried £0.00), so this is non-deterministic and a
// contractor cannot learn to expect it.
import { describe, expect, it } from "vitest";
import {
  PROVISIONAL_DUPLICATES_PRICE_PREFIX,
  isReconciliationFlag,
  provisionalsRepeatingFixedPrice,
  reconcileStatedPrice,
  withStatedPriceFlag,
} from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Works — see Scope of work",
  category: "other",
  quantity: 1,
  unit: "job",
  unit_price: 520,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

const FIXED_520 = { pricing: { mode: "fixed", fixed_amount: 520 } } as Partial<
  Pick<SowState, "pricing">
>;

/** Quote 09F065E5, as stored. */
const DOUBLED = [
  line({ description: "General works — see Scope of work", unit_price: 520 }),
  line({
    description: "Consumer unit replacement – fixed price",
    unit_price: 520,
    provisional: true,
  }),
  line({ description: "Waste removal", unit_price: 0, provisional: true }),
];

/** Job 31E0797F from the same script, which priced its provisional at £0.00. */
const CORRECT = [
  line({ description: "Works — see Scope of work", unit_price: 520 }),
  line({ description: "Consumer unit replacement", unit_price: 0, provisional: true }),
];

describe("a provisional sum priced at the whole fixed price", () => {
  it("is found", () => {
    const found = provisionalsRepeatingFixedPrice(FIXED_520, DOUBLED);
    expect(found).toHaveLength(1);
    expect(found[0].description).toBe("Consumer unit replacement – fixed price");
  });

  it("is reported to the contractor, naming the line and the damage", () => {
    const flag = reconcileStatedPrice(FIXED_520, DOUBLED);
    expect(flag ?? "").toContain(PROVISIONAL_DUPLICATES_PRICE_PREFIX);
    expect(flag ?? "").toContain("Consumer unit replacement – fixed price");
    expect(flag ?? "").toContain("£520.00");
  });

  it("is a recognised reconciliation flag, so it replaces rather than accumulates", () => {
    // Unregistered prefixes get a fresh copy appended on every save — the bug
    // RECONCILIATION_FLAG_PREFIXES exists to prevent.
    const flag = reconcileStatedPrice(FIXED_520, DOUBLED);
    expect(isReconciliationFlag(flag ?? "")).toBe(true);

    const once = withStatedPriceFlag([], FIXED_520, DOUBLED);
    const twice = withStatedPriceFlag(once, FIXED_520, DOUBLED);
    expect(twice).toEqual(once);
  });

  it("clears once the duplicate is corrected", () => {
    const fixed = withStatedPriceFlag(
      withStatedPriceFlag([], FIXED_520, DOUBLED),
      FIXED_520,
      CORRECT,
    );
    expect(fixed.filter((f) => f.startsWith(PROVISIONAL_DUPLICATES_PRICE_PREFIX))).toEqual([]);
  });
});

describe("what it leaves alone", () => {
  it("says nothing about the run that got it right", () => {
    expect(provisionalsRepeatingFixedPrice(FIXED_520, CORRECT)).toEqual([]);
    const flag = reconcileStatedPrice(FIXED_520, CORRECT);
    expect(flag ?? "").not.toContain(PROVISIONAL_DUPLICATES_PRICE_PREFIX);
  });

  it("leaves a genuine allowance of a different size alone", () => {
    // Unusual but coherent: exact equality is the duplicate's signature, and is
    // all this claims. A bigger allowance beside a small fixed price is the
    // contractor's business.
    const withAllowance = [
      line({ unit_price: 520 }),
      line({ description: "Allowance — hidden damage", unit_price: 800, provisional: true }),
    ];
    expect(provisionalsRepeatingFixedPrice(FIXED_520, withAllowance)).toEqual([]);
  });

  it("says nothing on a non-provisional line at the same figure", () => {
    // That is the works line itself, which is supposed to carry the price.
    expect(provisionalsRepeatingFixedPrice(FIXED_520, [line({ unit_price: 520 })])).toEqual([]);
  });

  it("says nothing outside fixed mode", () => {
    const days = { pricing: { mode: "days" } } as Partial<Pick<SowState, "pricing">>;
    expect(provisionalsRepeatingFixedPrice(days, DOUBLED)).toEqual([]);
  });

  it("does not fall over on a quote with no SoW at all", () => {
    // A typed-in quote reaches these guards with sow null — the null that
    // returned HTTP 500 from every save when absorbedByFixedPrice was cast.
    expect(provisionalsRepeatingFixedPrice(null, DOUBLED)).toEqual([]);
    expect(provisionalsRepeatingFixedPrice(undefined, DOUBLED)).toEqual([]);
  });
});
