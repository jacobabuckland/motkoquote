/**
 * A GBP 96 material allowance became 8 x GBP 96.
 *
 * Scenario 301 of the 20 Sep tranche, live: expected net GBP 346, actual
 * GBP 1,018 -- GBP 672 over, on a quote a contractor could have sent.
 *
 * I INTRODUCED THIS IN #843. That change narrowed the stated-quantity guard's
 * third condition from "the line is not already priced from the transcript" to
 * "a stated price did not already settle the count", and the reasoning behind
 * the narrowing was right as far as it went: "finish is twelve pounds a bag"
 * settles the RATE and says nothing about how many bags, so deferring to it
 * left eight bags billed as one.
 *
 * What it missed is the other thing a price can be. A LUMP SUM prices the line
 * WHOLE: "the material allowance is ninety six pounds" puts GBP 96 in
 * `unit_price` against a quantity of 1, because that is how a total is
 * represented on a line. It is not a rate. There is nothing for a count to
 * multiply, and multiplying it anyway turns the contractor's own figure into
 * eight times itself.
 *
 * The blunt old condition covered this by accident -- a lump-sum-priced line
 * is transcript-priced, so it was ineligible. Narrowing without naming the
 * lump-sum case removed the accident and left nothing in its place.
 *
 * So the rule names both ways a price governs a line's quantity: it carried a
 * count, or it is a lump sum. Everything #843 fixed keeps working, because in
 * every one of those cases the price is PER-UNIT and carried no count --
 * exactly the gap that is left, and the only one.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { StatedQuantity } from "@/lib/voice/stated-quantities";

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: null,
  ...over,
});

const finish: DraftLineItem = {
  kind: "material",
  description: "Finish",
  quantity: 1,
  unit: "bag",
  estimated_unit_cost_pence: 1200,
  supplied_by: "contractor",
};

const eightBags: StatedQuantity = {
  item: "finish",
  quantity: 8,
  unit: "bag",
  transcript_span: "eight bags of finish",
};

const price = (over: Partial<StatedPrice> = {}): StatedPrice => ({
  amount: 9600,
  item: "finish",
  quantity: null,
  caps_item: null,
  transcript_span: "the material allowance is ninety six pounds",
  qualifiers: { each: false, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
  ...over,
});

const perUnit = (over: Partial<StatedPrice> = {}): StatedPrice =>
  price({
    amount: 1200,
    transcript_span: "finish is twelve pounds a bag",
    qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
    ...over,
  });

const line = (prices: StatedPrice[], counts: StatedQuantity[] = [eightBags]) =>
  compileDraftToLineItems([finish], ctx(), [], prices, counts).lineItems[0]!;

const charged = (l: { quantity: number; unit_price: number }) => l.quantity * l.unit_price;

describe("a lump sum is the whole amount, not a rate", () => {
  it("does not multiply a stated allowance by a count said beside it", () => {
    // The live defect: 8 x GBP 96 = GBP 768 against a stated GBP 96.
    expect(charged(line([price()]))).toBe(96);
  });

  it("leaves the line at one, because that is what a total is", () => {
    expect(line([price()]).quantity).toBe(1);
    expect(line([price()]).unit_price).toBe(96);
  });

  it("holds however large the count said beside it", () => {
    const many: StatedQuantity = { ...eightBags, quantity: 40 };

    expect(charged(line([price()], [many]))).toBe(96);
  });

  it("holds for a lump sum that is not round", () => {
    expect(charged(line([price({ amount: 9612 })]))).toBe(96.12);
  });
});

describe("what #843 fixed still works, because those prices are per-unit", () => {
  it("applies a count to a rate the contractor stated without one", () => {
    // "Eight bags of finish. Finish is twelve pounds a bag." -> 8 x 12.
    expect(charged(line([perUnit()]))).toBe(96);
    expect(line([perUnit()]).quantity).toBe(8);
  });

  it("still stands down where the per-unit price carried its own count", () => {
    const three: StatedQuantity = { ...eightBags, quantity: 3 };
    const withCount = perUnit({ quantity: 8 });

    expect(line([withCount], [three]).quantity).toBe(8);
    expect(charged(line([withCount], [three]))).toBe(96);
  });

  it("applies a count to a line no stated price reached at all", () => {
    // Nothing priced it, so nothing governs its quantity either.
    const only = compileDraftToLineItems([finish], ctx(), [], [], [eightBags]).lineItems[0]!;

    expect(only.quantity).toBe(8);
    expect(only.unpriced).toBe(true);
  });
});
