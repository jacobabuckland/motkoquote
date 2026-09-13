// Saving a quote that was TYPED rather than spoken returned HTTP 500.
//
// Reported 13 Sep from production, and confirmed in Sentry as
// JAVASCRIPT-NEXTJS-F — `TypeError: Cannot read properties of null (reading
// 'pricing')`, culprit `POST /jobs/[id]`, 9 events from 16:06Z. Ten save
// attempts across two jobs, zero successes; the contractor was shown
// "Couldn't save your changes — check your connection and try again" for a
// server fault, and the work was silently lost on reload.
//
// The chain:
//
//   updateQuoteLineItems  →  withStatedPriceFlag(flags, nextSow, priced,
//                              drafted_line_items_json)
//   withStatedPriceFlag   →  absorbedByFixedPrice(sow as Pick<…>, …)
//   absorbedByFixedPrice  →  resolvePricingMode(sow) → sow.pricing  ✗ null
//
// `nextSow` is null exactly when the job has no `sow_json`, which is every
// quote typed in through "Type the quote in instead" rather than dictated. The
// call site's CAST erased the `| null | undefined` the parameter had always
// declared, so the compiler never saw it coming.
//
// `reconcileStatedPrice`, the other half of the same guard and called one line
// earlier with the same value, has always accepted nullish. The asymmetry
// between the two is the whole bug.
import { describe, expect, it } from "vitest";
import { absorbedByFixedPrice } from "@/lib/pricing-mode";
import { withStatedPriceFlag } from "@/lib/stated-price-guard";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Work",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 100,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

// What a typed-in quote looks like on the save path: real lines, a drafted
// baseline, and no SoW at all.
const TYPED_QUOTE_LINES = [line({ description: "Plastering", unit_price: 300 })];
const DRAFTED_BASELINE = [line({ description: "Plastering", unit_price: 300 })];

describe("a job with no SoW — the quote was typed, not spoken", () => {
  it("does not throw when the flags are recomputed on save", () => {
    // The exact call updateQuoteLineItems makes, with nextSow null.
    expect(() =>
      withStatedPriceFlag(null, null, TYPED_QUOTE_LINES, DRAFTED_BASELINE),
    ).not.toThrow();
  });

  it("does not throw for an undefined SoW either", () => {
    expect(() =>
      withStatedPriceFlag([], undefined, TYPED_QUOTE_LINES, DRAFTED_BASELINE),
    ).not.toThrow();
  });

  it("keeps the flags it was given and adds no reconciliation flag", () => {
    // Nothing can be reconciled against a SoW that does not exist, so the
    // correct answer is "no new flags", not a guess.
    const flags = withStatedPriceFlag(
      ["Some unrelated flag"],
      null,
      TYPED_QUOTE_LINES,
      DRAFTED_BASELINE,
    );
    expect(flags).toEqual(["Some unrelated flag"]);
  });

  it("is safe with no drafted baseline either", () => {
    expect(() => withStatedPriceFlag(null, null, TYPED_QUOTE_LINES, null)).not.toThrow();
  });
});

describe("absorbedByFixedPrice accepts nullish, like reconcileStatedPrice beside it", () => {
  it("returns null rather than throwing", () => {
    expect(absorbedByFixedPrice(null, DRAFTED_BASELINE)).toBeNull();
    expect(absorbedByFixedPrice(undefined, DRAFTED_BASELINE)).toBeNull();
    expect(absorbedByFixedPrice({ pricing: null }, DRAFTED_BASELINE)).toBeNull();
  });
});

describe("the guard still fires where it should", () => {
  it("still reports work absorbed by a fixed price on a spoken quote", () => {
    // The £350-for-£4,520 case: the guard must not have been softened into
    // silence by making the SoW optional.
    const absorbed = absorbedByFixedPrice(
      { pricing: { mode: "fixed", fixed_amount: 350 } },
      [line({ description: "Plastering", unit_price: 4520 })],
    );
    expect(absorbed).not.toBeNull();
    expect(absorbed).toContain("350");
    expect(absorbed).toContain("4520");
  });
});
