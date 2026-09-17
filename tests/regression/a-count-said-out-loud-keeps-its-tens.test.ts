/**
 * "Twenty-six bags" is twenty-six bags, not six.
 *
 * Both readers of a spoken count flatten a hyphen to a space and then take the
 * token NEAREST the unit. So a compound arrived as two words and only the last
 * one was read:
 *
 *     "Twenty-six bags of finishing plaster at £10.80 each"  ->  quantity 6
 *
 * £64.80 on a line the contractor had just said was £280.80, with the count in
 * front of them the whole time. Every compound between twenty-one and
 * ninety-nine undercharged by its tens digit.
 *
 * The count table's own comment says a wrong count is worse than an absent one,
 * which is the rule this violated rather than a case it had not considered — a
 * lone "sixty" yields nothing to this day and that is deliberate. So a compound
 * now reads whole, and nothing else about which words count has moved.
 *
 * Found while diagnosing TR30's canary, not by it.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { lineItemTotal } from "@/lib/quote-math";
import type { DraftLineItem } from "@/lib/schemas/job";
import { extractStatedPrices, perUnitCountBefore } from "@/lib/voice/stated-prices";

const quantityFor = (transcript: string) => extractStatedPrices(transcript)[0]?.quantity ?? null;

describe("a compound count beside a per-unit price", () => {
  it("keeps its tens when the transcript hyphenates it", () => {
    expect(quantityFor("Twenty-six bags of finishing plaster at £10.80 each.")).toBe(26);
  });

  it("keeps its tens when the transcript spaces it", () => {
    expect(quantityFor("Twenty six bags of finishing plaster at £10.80 each.")).toBe(26);
  });

  it("reads every decade, not just the twenties", () => {
    expect(quantityFor("Thirty-two sheets of ply at £28 each.")).toBe(32);
    expect(quantityFor("Forty-five bags of plaster at £10 each.")).toBe(45);
    // Past where the count words stop, because otherwise the same undercharge
    // survives one decade up.
    expect(quantityFor("Sixty-five bags of plaster at £10 each.")).toBe(65);
    expect(quantityFor("Ninety-nine bags of plaster at £10 each.")).toBe(99);
  });

  it("is read the same way by the no-marker path", () => {
    // "18 bags of finish at £11.50" — a count in front, no trailing "each".
    expect(perUnitCountBefore("Twenty-six bags of finishing plaster at ")).toBe(26);
    expect(perUnitCountBefore("Twenty six bags of plaster at ")).toBe(26);
  });
});

describe("what deliberately has not moved", () => {
  it("still reads a plain single word", () => {
    expect(quantityFor("Fifteen bags of plaster at £10 each.")).toBe(15);
    expect(quantityFor("Twenty bags of plaster at £10 each.")).toBe(20);
  });

  it("still reads digits", () => {
    expect(quantityFor("26 bags of finishing plaster at £10.80 each.")).toBe(26);
  });

  it("still says nothing for a lone count word above fifty", () => {
    // Absent, not wrong: the count table stops at fifty on the judgement that a
    // large count is said as digits, and this change does not revisit that.
    expect(quantityFor("Sixty bags of plaster at £10 each.")).toBeNull();
  });
});

describe("what the contractor is charged", () => {
  const context = (): CompileContext => ({
    day_rate: 250,
    overtime_rate: null,
    markup_pct: 0,
    team_members: [],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Jake",
    has_pricing_history: false,
    labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
  });

  it("bills all twenty-six bags", () => {
    const draft: DraftLineItem[] = [
      {
        kind: "material",
        description: "Finishing plaster",
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
      extractStatedPrices("Twenty-six bags of finishing plaster at £10.80 each.", []),
    );
    const plaster = result.lineItems.find((i) => i.description === "Finishing plaster")!;

    expect(plaster.quantity, "six bags were billed for twenty-six").toBe(26);
    expect(lineItemTotal(plaster)).toBeCloseTo(280.8, 2);
  });
});
