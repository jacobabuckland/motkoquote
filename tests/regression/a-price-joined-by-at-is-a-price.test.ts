/**
 * "One tub of primer at 27" is twenty-seven pounds.
 *
 * A bare integer does not parse as money, deliberately: an unmarked number may
 * be a count, and only >= 100 is confidently pounds. The extractor already made
 * one exception — "27 each" can be nothing but money — and the reasoning for a
 * second was already written down elsewhere in the same file, where
 * PER_UNIT_COUNT_BEFORE rests on "'for £600' reads as a total, 'at £11.50' as a
 * rate". It had simply never been applied to a number that failed to parse.
 *
 * So "1 tub of primer at 27" extracted NOTHING while "two tubs of primer at 27
 * each" — the same price, one word longer — extracted £27. Scenarios 48 and 41
 * of the 17 Sep tranche lost £27 of primer and £96 of finish to it. Not
 * mispriced: absent, so the line reached the quote unpriced and the contractor
 * undercharged unless they caught it by eye.
 *
 * The rule is bounded by the end of the clause, which is what separates a price
 * from a time, an address and a measurement — each of those carries on past the
 * number, and each stays out.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const priced = (transcript: string) =>
  extractStatedPrices(transcript, []).map((p) => [p.item, p.amount] as const);

describe("a bare amount joined by at", () => {
  it("prices the primer scenario 48 dropped", () => {
    expect(priced("1 tub of primer at 27")).toEqual([["primer", 2700]]);
  });

  it("keeps the count that goes with it", () => {
    const [price] = extractStatedPrices("Six bags of finish at 16", []);

    expect(price?.amount).toBe(1600);
    expect(price?.quantity).toBe(6);
  });

  it("reads the whole of scenario 48's sentence, both prices", () => {
    // The finish already worked; the primer is what this adds. Both, from one
    // sentence, is the claim.
    expect(
      priced(
        "6 bags of finish at 11.50 each, 1 tub of primer at 27",
      ),
    ).toEqual([
      ["finish", 1150],
      ["primer", 2700],
    ]);
  });

  it("reads a list joined by and", () => {
    expect(priced("Mixer hire at 45 and parking at 12")).toEqual([
      ["Mixer hire", 4500],
      ["parking", 1200],
    ]);
  });
});

describe("what carries on past the number, and so is not money", () => {
  it("leaves a measurement alone", () => {
    expect(extractStatedPrices("Working at 40 square metres", [])).toEqual([]);
    expect(extractStatedPrices("Skimming at 30 square metres a day", [])).toEqual([]);
  });

  it("leaves a count of things alone", () => {
    expect(extractStatedPrices("Priced at 3 coats", [])).toEqual([]);
  });

  it("leaves a house number alone", () => {
    expect(extractStatedPrices("It's at 27 Green Lane", [])).toEqual([]);
    expect(extractStatedPrices("Customer at 14 Acacia Avenue", [])).toEqual([]);
  });

  it("leaves a duration alone", () => {
    expect(extractStatedPrices("Daniel at 3 days", [])).toEqual([]);
  });
});

describe("a clock, which ends its clause exactly as a price does", () => {
  it("is not read as money after the verbs that put a time there", () => {
    for (const said of [
      "I'll start at 8",
      "We'll be there at 7",
      "I'll knock off at 4",
      "Back at 9",
    ]) {
      expect(extractStatedPrices(said, []), said).toEqual([]);
    }
  });

  it("still reads finish as the material it is", () => {
    // "finish" is deliberately absent from that list of verbs: a plasterer's
    // finish is a thing they buy, and excluding it would trade one silent drop
    // for another.
    expect(priced("Six bags of finish at 16")).toEqual([["finish", 1600]]);
  });
});

describe("what could not already be said", () => {
  it("does not disturb an amount that states its own currency", () => {
    expect(priced("1 tub of primer at £27")).toEqual([["primer", 2700]]);
  });

  it("does not disturb an unmarked amount that was already money", () => {
    // >= 100 parses on the existing heuristic and never reaches this rule.
    expect(priced("Waste removal at 165")).toEqual([["Waste removal", 16500]]);
  });
});

describe("what the contractor is charged", () => {
  it("bills the primer instead of leaving the row unpriced", () => {
    const context: CompileContext = {
      day_rate: 235,
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
        {
          kind: "material",
          description: "Primer",
          quantity: 1,
          unit: "tub",
          supplied_by: "contractor",
          estimated_unit_cost_pence: 1000,
        } as unknown as DraftLineItem,
      ],
      context,
      [],
      extractStatedPrices("1 tub of primer at 27", []),
    );
    const primer = result.lineItems.find((i) => i.description === "Primer")!;

    expect(primer.unpriced ?? false, "scenario 48 shipped this row at £0").toBe(false);
    expect(lineItemTotal(primer)).toBe(27);
  });
});
