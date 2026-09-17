/**
 * "Eleven fifty a bag" is £11.50 a bag, not £1,150 a bag.
 *
 * `parseSpokenMoneyAmount` handles a WRITTEN amount -- "£10.80", "14.50 pounds"
 * -- in a branch of its own, because the normalisation after it strips both the
 * pound sign and the decimal point as punctuation. That branch required a
 * currency marker, so that a bare "26" stayed a possible quantity rather than
 * becoming money.
 *
 * Right for an integer, wrong for a decimal, and the failure was not a refusal.
 * A bare "11.50" fell through, lost its point, became the bare number 1150, and
 * the `value >= 100` heuristic read THAT as pounds:
 *
 *     "6 bags of finish at 11.50 each"   ->  £1,150.00 a bag
 *     "4 bags at 12.5 each"              ->  £125.00 a bag
 *
 * Two of the 30 live runs on 17 Sep, both upward, both on a customer-facing
 * quote. One billed £6,900 of plaster for £69 of plaster and totalled £7,370
 * against an expected £566; the other £8,930 against £336.80. The contractor
 * flag beside the first read "The locked price for 'finish' (£1,150.00 each)
 * has been noted" -- the app was charging exactly what it had parsed, so
 * nothing downstream could have caught it.
 *
 * Nobody says "11.50 bags". One or two digits after a point is money in every
 * reading, so the decimal point is now a currency marker in its own right.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a decimal with no currency marker", () => {
  it("is pounds and pence, not pounds", () => {
    expect(parseSpokenMoneyAmount("11.50"), "£11.50, not £1,150").toBe(1150);
  });

  it("reads a single decimal place as tens of pence", () => {
    // "12.5" is twelve pounds fifty, the same as "£12.5" already was.
    expect(parseSpokenMoneyAmount("12.5")).toBe(1250);
  });

  it("agrees with the same amount said with a marker", () => {
    for (const marked of ["£11.50", "11.50 pounds", "11.50 quid"]) {
      expect(parseSpokenMoneyAmount(marked), marked).toBe(1150);
    }
  });
});

describe("a bare integer, which must not move", () => {
  it("is still left to the general path", () => {
    // The reason the marker was required: an unmarked integer may be a count.
    expect(parseSpokenMoneyAmount("27")).toBeNull();
  });

  it("still reads a large unmarked integer as pounds", () => {
    expect(parseSpokenMoneyAmount("340")).toBe(34000);
  });
});

describe("what the extractor makes of it", () => {
  it("locks the rate the contractor actually said", () => {
    const [price] = extractStatedPrices("6 bags of finish at 11.50 each", []);

    expect(price?.amount).toBe(1150);
    expect(price?.quantity).toBe(6);
  });

  it("does the same for the other run's rate", () => {
    const [price] = extractStatedPrices("Seven bags of finish at 12.40 a bag", []);

    expect(price?.amount).toBe(1240);
    expect(price?.quantity).toBe(7);
  });

  it("still refuses to read a measurement as money", () => {
    // The guard this could have weakened: a bare number before a unit is a
    // quantity. A decimal one is no different.
    expect(extractStatedPrices("We're skimming 148 square metres of walls", [])).toEqual([]);
    expect(extractStatedPrices("We're skimming 40.5 square metres of walls", [])).toEqual([]);
  });

  it("still records a day rate as a refusal rather than a locked price", () => {
    const [price] = extractStatedPrices("Labour is 250 a day.", []);

    expect(price?.amount).toBe(25000);
  });
});

describe("what the customer would have been charged", () => {
  const context = (): CompileContext => ({
    day_rate: 235,
    overtime_rate: null,
    markup_pct: 0,
    team_members: [],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Jake",
    has_pricing_history: false,
    labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
  });

  it("bills six bags of finish at sixty-nine pounds, not six thousand nine hundred", () => {
    const draft: DraftLineItem[] = [
      {
        kind: "material",
        description: "Multi-finish plaster",
        quantity: 1,
        unit: "bag",
        supplied_by: "contractor",
        estimated_unit_cost_pence: 1000,
      } as DraftLineItem,
    ];
    const result = compileDraftToLineItems(
      draft,
      context(),
      [],
      extractStatedPrices("6 bags of finish at 11.50 each", []),
    );
    const finish = result.lineItems.find((i) => i.description === "Multi-finish plaster")!;

    expect(finish.unit_price, "the flag read 'locked price ... £1,150.00 each'").toBe(11.5);
    expect(finish.quantity).toBe(6);
    expect(lineItemTotal(finish)).toBe(69);
  });
});
