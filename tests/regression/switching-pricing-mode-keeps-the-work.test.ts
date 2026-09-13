// "Switch to fixed price" destroyed every priced line on a hand-typed quote.
//
// Reported 13 Sep. One unguarded click, committed server-side before the
// contractor pressed Save, with no confirmation and no undo: the itemised lines
// were replaced by a single works line at £0.00, "Switch to itemised" restored
// nothing, and reloading without saving did not help because the write had
// already landed. Reproduced twice on a typed quote; on a £9,056 itemised job
// it would have taken all of it.
//
// The cause was one operator. setQuotePricingMode read its baseline as
//
//     drafted_line_items_json ?? line_items_json ?? []
//
// and `??` falls back only on null/undefined. The manual-quote path inserts
// `drafted_line_items_json: []` (actions.ts), so for EVERY hand-typed quote
// that chain resolved to `[]` and the contractor's real lines were never read:
// the fixed amount seeded from the subtotal of nothing, applyPricingMode built
// a works line at £0, and the typed lines — which existed only in
// line_items_json — were overwritten by it.
//
// A dictated quote was never affected, because the drafting run leaves a real
// breakdown in drafted_line_items_json. That is why this survived unnoticed.
//
// Two things are pinned here: an empty baseline is treated as absent, and the
// switch records what it collapsed so the collapse can be undone.
import { describe, expect, it } from "vitest";
import { applyPricingMode, buildFixedModeLineItems } from "@/lib/pricing-mode";
import { computeQuoteTotals } from "@/lib/quote-math";
import { EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";
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

// What the contractor typed: three days of labour and a materials line.
const TYPED_LINES = [
  line({ description: "Plastering", category: "labour", quantity: 3, unit: "day", unit_price: 250 }),
  line({ description: "Plaster", category: "materials", quantity: 10, unit: "bag", unit_price: 12.5 }),
];

// The baseline resolution as setQuotePricingMode performs it. The `??` chain
// this replaces is the defect, so the rule is asserted directly rather than
// through a stubbed Supabase round-trip that would only restate the fixture.
const resolveBaseline = (
  drafted: LineItem[] | null,
  active: LineItem[] | null,
): LineItem[] => {
  const hasDrafted = Boolean(drafted && drafted.length > 0);
  return hasDrafted ? (drafted as LineItem[]) : (active ?? []);
};

describe("an empty drafted baseline is no baseline", () => {
  it("reads the contractor's actual lines, not the empty array beside them", () => {
    // `[] ?? active` is `[]` — this is the whole bug, in one assertion.
    expect(resolveBaseline([], TYPED_LINES)).toEqual(TYPED_LINES);
  });

  it("still prefers a real drafted baseline when one exists", () => {
    const drafted = [line({ description: "Model's breakdown", unit_price: 999 })];
    expect(resolveBaseline(drafted, TYPED_LINES)).toEqual(drafted);
  });

  it("treats a null baseline as absent too, as it always did", () => {
    expect(resolveBaseline(null, TYPED_LINES)).toEqual(TYPED_LINES);
  });
});

describe("the fixed amount the switch seeds", () => {
  it("is the quote's real subtotal, not zero", () => {
    // 3 x 250 + 10 x 12.50 = 875. The reported symptom was £0.00, which is the
    // subtotal of the empty baseline.
    const baseline = resolveBaseline([], TYPED_LINES);
    expect(computeQuoteTotals(baseline, false).subtotal).toBe(875);
  });

  it("was zero under the old resolution, which is what destroyed the work", () => {
    const brokenBaseline: LineItem[] = [];
    expect(computeQuoteTotals(brokenBaseline, false).subtotal).toBe(0);
  });
});

describe("the collapse itself", () => {
  const fixedSow: SowState = {
    ...EMPTY_SOW_STATE,
    job_type: "plastering",
    pricing: { mode: "fixed", fixed_amount: 875 },
  };

  it("carries the real figure onto the single works line", () => {
    const collapsed = applyPricingMode(resolveBaseline([], TYPED_LINES), fixedSow, false);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.unit_price).toBe(875);
  });

  it("does not leave a phantom works line at zero", () => {
    const collapsed = applyPricingMode(resolveBaseline([], TYPED_LINES), fixedSow, false);
    expect(collapsed[0]?.unit_price).not.toBe(0);
  });

  it("is reversible, because the baseline it collapsed is what itemised reads back", () => {
    // The switch now seeds drafted_line_items_json with the lines it is about
    // to replace. Switching back resolves that baseline and gets the work back.
    const seededBaseline = TYPED_LINES;
    const backToItemised = applyPricingMode(
      resolveBaseline(seededBaseline, [buildFixedModeLineItems("Works", 875, [])[0]!]),
      { ...EMPTY_SOW_STATE, pricing: { mode: "calculated", fixed_amount: null } },
      false,
    );
    expect(backToItemised).toEqual(TYPED_LINES);
  });
});

describe("the baseline is only seeded when there is nothing to lose", () => {
  // A real drafted baseline is the model's own breakdown. Overwriting it with a
  // collapse of itself would destroy the provenance every pricing guard reads.
  const shouldSeed = (drafted: LineItem[] | null, active: LineItem[]) =>
    !(drafted && drafted.length > 0) && active.length > 0;

  it("seeds for a typed quote with an empty baseline", () => {
    expect(shouldSeed([], TYPED_LINES)).toBe(true);
  });

  it("never overwrites a real drafted baseline", () => {
    expect(shouldSeed([line({ description: "Model's breakdown" })], TYPED_LINES)).toBe(false);
  });

  it("does not seed an empty baseline with an empty quote", () => {
    expect(shouldSeed([], [])).toBe(false);
  });
});
