/**
 * A qualifier and an item name belong to ONE amount, not to the sentence.
 *
 * Trades state several materials in a breath: "26 bags of finishing plaster at
 * £10.80 each, 8 bags of backing plaster at £14.50 each, 4 tubs of primer at
 * £26 each, and one protection and consumables allowance of £95." Two things
 * went wrong on that sentence, and both are money.
 *
 *   * `each` was read from the whole sentence, so the £95 allowance — stated
 *     once, for the whole job — came back per-unit. `applyStatedPrice`
 *     multiplies an `each` price by the line's quantity, so a four-unit line
 *     would have billed £380 for it.
 *   * The item name kept the preposition that joined it to its price
 *     ("finishing plaster at"), which is exactly what stopped it matching a
 *     line called "Finishing plaster". A price that matches no item falls to
 *     span matching, which refuses to guess between several lines sharing one
 *     sentence — so the price attached to nothing and the line was zeroed as
 *     unsourced.
 *
 * That second one is the mechanism behind materials arriving at £0.00 on voice
 * runs 01, 03 and 05. The prices were extracted. Every one was dropped at the
 * join.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

// The contractor's turn from voice run 01, verbatim.
const MATERIALS_SENTENCE =
  "We supply 26 bags of finishing plaster at £10.80 each, 8 bags of backing " +
  "plaster at £14.50 each, 4 tubs of primer at £26 each, and one protection " +
  "and consumables allowance of £95.";

const priceFor = (amount: number) =>
  extractStatedPrices(MATERIALS_SENTENCE, []).find((p) => p.amount === amount);

describe("a qualifier belongs to its own amount", () => {
  it("marks the per-unit prices per-unit", () => {
    expect(priceFor(1080)?.qualifiers.each).toBe(true);
    expect(priceFor(1450)?.qualifiers.each).toBe(true);
    expect(priceFor(2600)?.qualifiers.each).toBe(true);
  });

  it("does not make a one-off allowance per-unit because a neighbour was", () => {
    // The £95 is the last amount in a sentence with three "each"es in it.
    expect(priceFor(9500)?.qualifiers.each).toBe(false);
  });

  it("reads only the words after an amount, never the ones before", () => {
    // "…at £28 each, £160 protection materials" puts the previous amount's
    // "each" three words in FRONT of the £160, so a symmetric window would
    // reproduce the bug it fixes.
    const prices = extractStatedPrices(
      "Three tubs of primer at £28 each, £160 protection materials, and £220 waste removal.",
      [],
    );

    expect(prices.find((p) => p.amount === 2800)?.qualifiers.each).toBe(true);
    expect(prices.find((p) => p.amount === 16000)?.qualifiers.each).toBe(false);
    expect(prices.find((p) => p.amount === 22000)?.qualifiers.each).toBe(false);
  });
});

describe("an item name is the item, not the join", () => {
  it("drops the preposition that attaches a name to its price", () => {
    expect(priceFor(1080)?.item).toBe("finishing plaster");
    expect(priceFor(1450)?.item).toBe("backing plaster");
    expect(priceFor(2600)?.item).toBe("primer");
  });

  it("keeps a connector that is part of the name", () => {
    // Only the ENDS are trimmed — "tape and protection" is one thing.
    const prices = extractStatedPrices(
      "Allow 11 2-metre beads at 4 pounds 50 each, and 65 pounds for tape and protection.",
      [],
    );

    expect(prices.find((p) => p.amount === 6500)?.item).toBe("tape and protection");
  });
});

describe("the price reaches the line it names", () => {
  const context = (): CompileContext => ({
    day_rate: 250,
    overtime_rate: null,
    markup_pct: 100,
    team_members: [],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Owner",
    has_pricing_history: false,
    labour_plan: { people_count: 1, duration_days: 4, crew_description: null },
  });

  const drafts: DraftLineItem[] = [
    {
      kind: "material",
      description: "Finishing plaster",
      quantity: 26,
      unit: "bag",
      supplied_by: "contractor",
      estimated_unit_cost_pence: 5000,
    },
    {
      kind: "material",
      description: "Protection and consumables allowance",
      quantity: 1,
      unit: "sum",
      supplied_by: "contractor",
      estimated_unit_cost_pence: 5000,
    },
  ];

  it("prices a material at what the contractor said, times the quantity", () => {
    const result = compileDraftToLineItems(
      drafts,
      context(),
      [],
      extractStatedPrices(MATERIALS_SENTENCE, []),
    );

    const plaster = result.lineItems.find((i) => i.description === "Finishing plaster");

    // 26 bags at the stated £10.80 — not £0.00 "Not priced", and not the
    // model's £50 estimate with the 100% markup on top.
    expect(plaster?.unit_price).toBe(10.8);
    expect(lineItemTotal(plaster!)).toBe(280.8);
    expect(plaster?.unpriced).toBeUndefined();
    expect(plaster?.provenance?.source).toBe("transcript");
  });

  it("charges a one-off allowance once", () => {
    const result = compileDraftToLineItems(
      drafts,
      context(),
      [],
      extractStatedPrices(MATERIALS_SENTENCE, []),
    );

    const allowance = result.lineItems.find((i) =>
      i.description.startsWith("Protection and consumables"),
    );

    expect(lineItemTotal(allowance!)).toBe(95);
  });
});
