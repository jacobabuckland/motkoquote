/**
 * A per-unit price is multiplied by the count the CONTRACTOR said.
 *
 * `applyStatedPrice` multiplies an `each` price by a quantity, and the quantity
 * it used came from the drafting model's line. The model writes the count into
 * the DESCRIPTION and leaves `quantity` at 1 — "Finishing plaster – for
 * skimming walls in two bedrooms (eight bags)", quantity 1 — so "eight bags of
 * bonding at eleven pounds a bag" was charged as £11 against a stated £88.
 * Four of five voice runs on 16 Sep, undercharging every time, on a quote the
 * contractor sends to a customer.
 *
 * The extractor already FINDS these numbers. `followedByUnit` exists so that
 * "28 bags" is stepped over rather than mistaken for £28; it simply threw the
 * count away instead of recording it.
 *
 * Two things this file pins that a narrower test would have missed:
 *
 *   * The stated count must be preferred OVER the argument `compileDraftToLineItems`
 *     passes, not under it. Both call sites compute that argument as
 *     `draft.quantity ?? item.quantity`, which is always a number — so ordering
 *     the stated count second leaves it permanently unreachable. The first
 *     version of this fix did exactly that: green tests, no behaviour change.
 *   * "eleven pounds a bag" must be per-unit. "a" is a money word (so that
 *     "seven and a half thousand" parses), which swallowed the article into the
 *     amount and left PER_UNIT_AFTER_PRICE nothing to anchor on. "£11 a bag"
 *     worked throughout, which is what hid it.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const context = (): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: false,
  labour_plan: { people_count: 1, duration_days: 2, crew_description: null },
});

describe("the count stated beside a per-unit price", () => {
  it("is recorded, in the spoken form and the written one", () => {
    for (const sentence of [
      "We'll need eight bags of bonding at eleven pounds a bag.",
      "We'll need eight bags of bonding at £11 a bag.",
      "We'll need eight bags of bonding at eleven pounds per bag.",
      "Eight bags of bonding at eleven pounds each.",
    ]) {
      const price = extractStatedPrices(sentence, []).find((p) => p.amount === 1100);

      expect(price?.qualifiers.each, sentence).toBe(true);
      expect(price?.quantity, sentence).toBe(8);
    }
  });

  it("reads the count nearest the price, not the first number in the sentence", () => {
    // Run 20's sentence shape: two counts, two prices, one sentence.
    const prices = extractStatedPrices(
      "That's 28 bags of finish at £11.20 each and 7 bags of bonding at £14.50 each.",
      [],
    );

    expect(prices.find((p) => p.amount === 1120)?.quantity).toBe(28);
    expect(prices.find((p) => p.amount === 1450)?.quantity).toBe(7);
  });

  it("is absent on a lump sum, which has no count to carry", () => {
    const price = extractStatedPrices("I'll do the whole job for two thousand pounds all in.", [])
      .find((p) => p.amount === 200000);

    expect(price?.qualifiers.each).toBe(false);
    // Absent, not null: nobody said a count. `tests/acceptance/519.test.ts`
    // compares whole extracted records and three of its scenarios state none.
    expect(price && "quantity" in price).toBe(false);
  });
});

describe("the count that reaches the quote", () => {
  // The model's line, as production captured it: the count is prose inside the
  // description and `quantity` is 1.
  const drafts: DraftLineItem[] = [
    {
      kind: "material",
      description: "Bonding",
      quantity: 1,
      unit: "bag",
      supplied_by: "contractor",
      estimated_unit_cost_pence: 1400,
    },
  ];

  const compile = (sentence: string) =>
    compileDraftToLineItems(drafts, context(), [], extractStatedPrices(sentence, []));

  it("charges eight bags, not one", () => {
    const line = compile("We'll need eight bags of bonding at eleven pounds a bag.")
      .lineItems.find((i) => i.description === "Bonding");

    expect(line?.unit_price).toBe(11);
    expect(line?.quantity, "the model's 1 must not win over the contractor's eight").toBe(8);
    expect(lineItemTotal(line!)).toBe(88);
  });

  it("still takes the model's count when the contractor stated none", () => {
    // "£11 each" with no count anywhere — there is nothing better than the
    // draft's own quantity, so it keeps it.
    const line = compile("Bonding is eleven pounds each.")
      .lineItems.find((i) => i.description === "Bonding");

    expect(line?.quantity).toBe(1);
    expect(lineItemTotal(line!)).toBe(11);
  });

  it("leaves a lump sum charged once", () => {
    const lumpDrafts: DraftLineItem[] = [
      {
        kind: "material",
        description: "Protection and consumables",
        quantity: 4,
        unit: "sum",
        supplied_by: "contractor",
        estimated_unit_cost_pence: 5000,
      },
    ];

    const result = compileDraftToLineItems(
      lumpDrafts,
      context(),
      [],
      extractStatedPrices("Protection and consumables is ninety five pounds.", []),
    );
    const line = result.lineItems.find((i) => i.description === "Protection and consumables");

    expect(lineItemTotal(line!)).toBe(95);
  });
});
