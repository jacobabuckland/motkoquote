/**
 * A price the contractor stated once is charged once.
 *
 * `resolveStatedPrices` matches in two passes. Pass 2 (span matching) has
 * always refused ambiguity in both directions — a line that could have come
 * from several things said, and a thing said that could be several lines:
 *
 *     if (forLine.length !== 1) continue;
 *     if ((claimants.get(forLine[0]) ?? 0) !== 1) continue;
 *
 * Pass 1 (item matching) kept a `claimed` set, wrote to it, and never read it
 * back. So a stated price priced EVERY line whose description matched. On job
 * d2fa171f two placeholder lines both carrying the word "finish" were each
 * charged 18 × £11.50 and the quote subtotalled £414 for £207 of plaster.
 *
 * The defect was the asymmetry, not a missing policy — so pass 1 now answers to
 * the rule pass 2 already states.
 *
 * Refused rather than first-line-wins: "first" is the drafting model's
 * ordering, so taking it is a coin flip over which line gets the money. An
 * ambiguous price attaches to nothing and the contractor is told, which is the
 * only honest outcome — they are the one who knows which line it was.
 *
 * Worth recording that the £414 is an amplification. With the count-in-front
 * rule (#793) disabled the same defect bills £23, because the price reached a
 * line of one. #793 turned an undercharge into an overcharge; this is the
 * residual risk that rule was proposed with, arriving by an unanticipated path.
 */

import { describe, expect, it } from "vitest";
import {
  UNATTACHED_STATED_PRICE_PREFIX,
  compileDraftToLineItems,
  type CompileContext,
} from "@/lib/compile-draft";
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
  owner_label: "Jake",
  has_pricing_history: false,
  labour_plan: { people_count: 1, duration_days: 1, crew_description: null },
});

const material = (description: string): DraftLineItem =>
  ({
    kind: "material",
    description,
    quantity: 1,
    unit: "sum",
    supplied_by: "contractor",
    estimated_unit_cost_pence: 1000,
  }) as DraftLineItem;

const compile = (descriptions: string[], sentence: string) =>
  compileDraftToLineItems(
    descriptions.map(material),
    context(),
    [],
    extractStatedPrices(sentence, []),
  );

const subtotal = (result: ReturnType<typeof compile>) =>
  result.lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0);

describe("two lines that both answer to one stated price", () => {
  // Run 1's placeholders, verbatim. Both contain "finish".
  const DESCRIPTIONS = [
    "Bonding and multi-finish plaster materials",
    "Plasterboard and finish plaster",
  ];
  const SENTENCE = "Materials are 18 bags of finish at £11.50.";

  it("charges neither, rather than charging both", () => {
    const result = compile(DESCRIPTIONS, SENTENCE);

    expect(subtotal(result), "£207 of plaster was billed as £414").toBe(0);
    expect(result.lineItems.every((i) => i.unpriced === true)).toBe(true);
  });

  it("tells the contractor the price landed nowhere, and why that is theirs to fix", () => {
    const result = compile(DESCRIPTIONS, SENTENCE);
    const flag = result.contractorFlags.find((f) =>
      f.startsWith(UNATTACHED_STATED_PRICE_PREFIX),
    );

    expect(flag, "silence here is how £414 shipped").toBeDefined();
    expect(flag).toContain("£11.50");
    expect(flag).toContain("Put it on the right line before sending");
  });
});

describe("the ordinary case, which must not move", () => {
  it("prices the one line that matches", () => {
    const result = compile(
      ["Finishing plaster", "Waste removal"],
      "18 bags of finishing plaster at £11.50.",
    );
    const plaster = result.lineItems.find((i) => i.description === "Finishing plaster");

    expect(lineItemTotal(plaster!)).toBe(207);
    expect(
      result.contractorFlags.some((f) => f.startsWith(UNATTACHED_STATED_PRICE_PREFIX)),
      "one line, one price — nothing is unattached",
    ).toBe(false);
  });

  it("keeps two DIFFERENT prices on their two different lines", () => {
    const result = compile(
      ["Finishing plaster", "Primer"],
      "18 bags of finishing plaster at £11.50 and two tubs of primer at £27 each.",
    );

    expect(lineItemTotal(result.lineItems.find((i) => i.description === "Finishing plaster")!)).toBe(207);
    expect(lineItemTotal(result.lineItems.find((i) => i.description === "Primer")!)).toBe(54);
  });
});
