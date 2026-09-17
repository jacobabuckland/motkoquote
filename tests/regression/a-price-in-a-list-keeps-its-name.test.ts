/**
 * "Mixer hire, £45" names mixer hire. The comma is not the end of the thought.
 *
 * `extractItem` reads the words before an amount, and every one of its patterns
 * is anchored with `$`. `\w` matches no comma, so a phrase ending in one could
 * not reach the anchor at all and named nothing — while the identical words
 * without the comma named the item correctly.
 *
 * A trade listing several small costs prices them exactly that way:
 *
 *     "Add, mixer hire, £45; parking, £12; and waste removal, £165"
 *
 * All three amounts were extracted and all three lost their item, and an
 * item-less price matches no line. Run 51 of the 17 Sep tranche put mixer hire,
 * parking and waste removal on the quote at £0.00 each, with three flags saying
 * the money was said but is on no line: £250 billed for £472 of work.
 *
 * The comma still BOUNDS the name — `\s+` does not span one either, so "Add,
 * mixer hire" yields "mixer hire" and never reaches back to "Add".
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const LIST = "Add, mixer hire, £45; parking, £12; and waste removal, £165";

const named = (transcript: string) =>
  extractStatedPrices(transcript, []).map((p) => [p.item, p.amount] as const);

describe("several small costs listed in one breath", () => {
  it("gives every amount the name said in front of it", () => {
    expect(named(LIST)).toEqual([
      ["mixer hire", 4500],
      ["parking", 1200],
      ["waste removal", 16500],
    ]);
  });

  it("does not reach back past the comma into the previous item", () => {
    // "Add, mixer hire" is not an item called "Add mixer hire".
    expect(named(LIST)[0]?.[0]).toBe("mixer hire");
  });

  it("reads the same words without the comma identically", () => {
    expect(named("Mixer hire, £45")).toEqual(named("Mixer hire £45"));
  });
});

describe("a correction must still name nothing", () => {
  // The comma used to suppress these by accident. A correction has to come out
  // item-less or the supersession pass cannot find the group it belongs to.
  it("does not treat the word starting a correction as an item", () => {
    const prices = extractStatedPrices("Delivery is £60. Actually, no, £48.", []);
    const live = prices.filter((p) => p.superseded_by === null);

    expect(live.map((p) => [p.item, p.amount])).toEqual([["Delivery", 4800]]);
  });

  it("does not treat a confirmation as an item either", () => {
    // "Yes, six hundred pounds total" is the same £600 restated, not a second
    // price for an item called "Yes".
    const prices = extractStatedPrices(
      "The total is six hundred pounds. Yes, six hundred pounds total.",
      [],
    );

    expect(prices).toHaveLength(1);
    expect(prices[0]?.amount).toBe(60000);
  });
});

describe("what the contractor is charged", () => {
  it("bills all three, instead of flagging all three as homeless", () => {
    const material = (description: string): DraftLineItem =>
      ({
        kind: "material",
        description,
        quantity: 1,
        unit: "item",
        supplied_by: "contractor",
        estimated_unit_cost_pence: 1000,
      }) as DraftLineItem;

    const context: CompileContext = {
      day_rate: 250,
      overtime_rate: null,
      markup_pct: 0,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Jake",
      has_pricing_history: false,
      labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
    };

    const result = compileDraftToLineItems(
      [
        material("Mixer hire — one-off"),
        material("Parking — one-off"),
        material("Waste removal — one-off"),
      ],
      context,
      [],
      extractStatedPrices(LIST, []),
    );

    const materials = result.lineItems.reduce((sum, i) => sum + lineItemTotal(i), 0);

    expect(materials, "run 51 charged £0 for all three").toBe(222);
    expect(result.lineItems.some((i) => i.unpriced === true)).toBe(false);
    expect(
      result.contractorFlags.filter((f) => f.includes("isn't on any line")),
      "three flags said the money was said and is nowhere",
    ).toEqual([]);
  });
});
