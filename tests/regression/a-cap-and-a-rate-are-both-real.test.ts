/**
 * "£45 a shift, but capped at £120 for the job" states two figures and the
 * relationship between them. Charge the lesser of rate × count and the cap.
 *
 * Both used to arrive as ordinary prices. The £45 landed on the equipment line,
 * the £120 landed nowhere, and the job undercharged by £75 — with a flag saying
 * two amounts had been stated, which nobody has to read. A cap phrased "no more
 * than £250" did not arrive at all: `isNegated` sees the "no" and drops the
 * amount before it is ever a candidate, so that cap was invisible rather than
 * merely misapplied.
 *
 * Jacob's call, 16 Sep. Four pieces, and this file is one describe per piece:
 * the negation guard learns that a cap is not a withdrawal; the cap is marked;
 * it is tied to the item it qualifies; and the clamp runs after pricing, where
 * a total exists to compare against.
 *
 * Where the cap does NOT bind, nothing happens and the metered line stands.
 * That is the common case and the one worth protecting.
 */

import { describe, expect, it } from "vitest";
import {
  CAPPED_LINE_PREFIX,
  compileDraftToLineItems,
  type CompileContext,
} from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const CAFE = "The equipment's £45 a shift, but they capped it at £120 for the job.";

const context = (): CompileContext => ({
  day_rate: 250,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: { people_count: 1, duration_days: 3, crew_description: null },
});

const material = (description: string, quantity: number): DraftLineItem =>
  ({
    kind: "material",
    description,
    quantity,
    unit: "shift",
    supplied_by: "contractor",
    estimated_unit_cost_pence: 1000,
  }) as DraftLineItem;

const compile = (drafts: DraftLineItem[], sentence: string) =>
  compileDraftToLineItems(drafts, context(), [], extractStatedPrices(sentence, []));

const totalOf = (result: ReturnType<typeof compile>) =>
  result.lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0);

describe("a cap is not a negation, though it is phrased like one", () => {
  it('extracts an amount introduced by "no more than"', () => {
    const prices = extractStatedPrices("Skip hire is £90 a load, no more than £250 in total.", []);

    expect(
      prices.some((p) => p.amount === 25000),
      "the £250 was dropped before it was ever a candidate",
    ).toBe(true);
  });

  it("still drops an amount that really is withdrawn", () => {
    // "not two fifty" takes a figure back. "no more than two fifty" states one.
    const prices = extractStatedPrices("The skim is four hundred, not two hundred and fifty.", []);

    expect(prices.some((p) => p.amount === 25000)).toBe(false);
  });
});

describe("a cap names what it caps", () => {
  it("ties the ceiling to the item priced before it in the same sentence", () => {
    const cap = extractStatedPrices(CAFE, []).find((p) => p.amount === 12000);

    expect(cap?.caps_item, '"it" is the word that says so').toBe("equipment");
  });

  it("leaves an ordinary price carrying no cap at all", () => {
    const rate = extractStatedPrices(CAFE, []).find((p) => p.amount === 4500);

    expect(rate && "caps_item" in rate).toBe(false);
  });

  it("does not reach into a previous sentence for something to cap", () => {
    const prices = extractStatedPrices("Equipment is £45 a shift. No more than £120.", []);
    const cap = prices.find((p) => p.amount === 12000);

    expect(cap?.caps_item ?? null).toBeNull();
  });
});

describe("the lesser of rate x count and the cap", () => {
  it("charges the cap when the rate would exceed it", () => {
    // Three shifts at £45 is £135. The contractor said £120.
    expect(totalOf(compile([material("Equipment", 3)], CAFE))).toBe(120);
  });

  it("charges the rate when it does not reach the cap", () => {
    // Two shifts at £45 is £90, and the cap is irrelevant. The metered line
    // must survive untouched — this is the common case.
    const result = compile([material("Equipment", 2)], CAFE);
    const line = result.lineItems[0];

    expect(totalOf(result)).toBe(90);
    expect(line?.quantity).toBe(2);
    expect(line?.unit_price).toBe(45);
  });

  it("works on a cap phrased as a negation", () => {
    expect(
      totalOf(compile([material("Skip hire", 4)], "Skip hire is £90 a load, no more than £250 in total.")),
    ).toBe(250);
  });

  it("leaves a line with no cap alone", () => {
    expect(
      totalOf(compile([material("Parking", 3)], "Parking's £12 a shift for one van, three shifts.")),
    ).toBe(36);
  });
});

describe("what the contractor is told", () => {
  it("shows both figures, since the rate leaves the line when the cap binds", () => {
    const result = compile([material("Equipment", 3)], CAFE);
    const flag = result.contractorFlags.find((f) => f.startsWith(CAPPED_LINE_PREFIX));

    expect(flag, "the arithmetic has to survive somewhere").toBeDefined();
    expect(flag).toContain("£135.00");
    expect(flag).toContain("£120.00");
  });

  it("says nothing when the cap does not bind", () => {
    const result = compile([material("Equipment", 2)], CAFE);

    expect(result.contractorFlags.some((f) => f.startsWith(CAPPED_LINE_PREFIX))).toBe(false);
  });
});
