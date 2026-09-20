/**
 * Scenario 41, three identical recordings on 20 Sep, GBP 84 short every time.
 *
 * The extractor output was byte-identical across all three, so this was never
 * model variance -- it was two deterministic defects that compound:
 *
 *   "I need 10 bags of finish. Sorry, make that 8 bags.
 *    They are GBP 12 each, not GBP 11. 8 at GBP 12 is the final figure."
 *
 *   quantities:  finish = 10   AND   BAG = 8
 *   prices:      GBP 12, no item, no count, lump sum
 *
 * 1. A CONTAINER IS NOT A MATERIAL. With no "of X" the reader falls back to
 *    the unit as the item, which is right for "eight sockets" -- a socket is
 *    the thing being bought -- and wrong for "eight bags", because nobody buys
 *    bags. So the correction was filed under "bag", never met the "finish" it
 *    was correcting, and the line kept the ten the contractor had withdrawn.
 *    The 19 Sep report filed this as ABBREVIATED-CORRECTION and rated it P2 on
 *    the grounds that no money moved. The money moved once the rate found the
 *    line.
 *
 * 2. A BARE COUNT IN FRONT DID NOT MAKE A PRICE PER-UNIT. "8 bags at GBP 12"
 *    has done so since #781, via `perUnitCountBefore`, which needs a countable
 *    unit between the number and the "at". "8 at GBP 12" has none, because the
 *    contractor said the unit a breath earlier. #843 added `bareCountBefore`
 *    for the form that carries a trailing "each"; without that marker it was
 *    never consulted, so the commonest phrasing came out a lump sum with no
 *    count and reached no line at all.
 *
 * Either one alone leaves the finish unpriced. Together they are the GBP 84.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import { contractorSaid } from "@/lib/voice/contractor-said";
import type { DraftLineItem } from "@/lib/schemas/job";

/** Scenario 41's opening, as transcribed in all three 20 Sep recordings. */
const T41 =
  "Quick draft for QA auto test customer 41. Small wall skim, 20 square metres, just me for one " +
  "day at my saved rate. I need 10 bags of finish. Sorry, make that 8 bags. They are £12 each, " +
  "not £11. 8 at £12 is the final figure. One primer tub at £25 as well. These are customer " +
  "prices before VAT with no markup. Preparation and cleaning are included. No other materials, " +
  "waste charge, or extras. Dates are not agreed. Just save the draft for me. Do not send it.";

const drafts: DraftLineItem[] = [
  {
    kind: "labour",
    description: "Plastering labour – small wall skim (20 square metres)",
    people: [{ ref: "owner", days: 1 }],
    overtime: false,
    includes_tasks: [],
  },
  {
    kind: "material",
    description: "Finishing plaster (multi-finish) – 8 bags for 20 square metre wall skim",
    quantity: 8,
    unit: "bag",
    estimated_unit_cost_pence: 12000,
    supplied_by: "contractor",
  },
  {
    kind: "material",
    description: "Primer tub – for wall preparation",
    quantity: 1,
    unit: "tub",
    estimated_unit_cost_pence: 2500,
    supplied_by: "contractor",
  },
];

const compiled = () => {
  const ctx: CompileContext = {
    day_rate: 250,
    overtime_rate: null,
    markup_pct: 0,
    team_members: [],
    rate_cards: [],
    known_material_prices: [],
    owner_label: "Owner",
    has_pricing_history: true,
    labour_plan: { people_count: 1, duration_days: 1, crew_description: "just me" },
    contractor_said: contractorSaid(T41),
  };
  return compileDraftToLineItems(
    drafts,
    ctx,
    [],
    extractStatedPrices(T41),
    extractStatedQuantities(T41),
  );
};

describe("scenario 41 reaches the figure the contractor stated", () => {
  it("prices the finish the contractor corrected to eight, at the rate they gave", () => {
    const finish = compiled().lineItems.find((l) => l.description.includes("Finishing"))!;

    expect(finish.quantity).toBe(8);
    expect(finish.unit_price).toBe(12);
    expect(finish.quantity * finish.unit_price).toBe(96);
  });

  it("comes to the expected net, not GBP 84 short of it", () => {
    const net = compiled().lineItems.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);

    expect(net).toBe(371);
  });

  it("does not report a figure that did reach a line as missing from the quote", () => {
    // The rate is stated twice, which is how a trade confirms a number. One
    // reaches the line; reporting the other says GBP 12 "isn't on any line"
    // beside a line reading 8 x GBP 12.
    const unattached = compiled().contractorFlags.filter((f) =>
      f.startsWith("Not on any line:"),
    );

    expect(unattached).toEqual([]);
  });
});

describe("a container is counted, but it is not the material", () => {
  it("lands an abbreviated correction on the thing it corrects", () => {
    const read = extractStatedQuantities("I need 10 bags of finish. Sorry, make that 8 bags.");

    expect(read).toHaveLength(1);
    expect(read[0]?.item).toBe("finish");
    expect(read[0]?.quantity).toBe(8);
  });

  it("stores one count, not a stale one beside it", () => {
    // Both persisted before: finish=10 AND bag=8, so a later draft could pick
    // up the ten the contractor had already withdrawn.
    const read = extractStatedQuantities("I need 10 bags of finish. Sorry, make that 8 bags.");

    expect(read.map((q) => q.item)).toEqual(["finish"]);
  });

  it("still lets a unit that IS the thing name itself", () => {
    // A socket is bought; a bag is not. The fallback is right here.
    expect(extractStatedQuantities("I need eight sockets")[0]?.item).toBe("socket");
    expect(extractStatedQuantities("Twelve tiles for the splashback")[0]?.item).toBe("tile");
  });

  it("drops a container count with nothing named before it", () => {
    // A count of nothing is not evidence of anything, and "bag" is not a
    // material to file it under.
    expect(extractStatedQuantities("I need six bags.")).toEqual([]);
  });

  it("is untouched where the container says what is in it", () => {
    expect(extractStatedQuantities("I need six bags of backing plaster")[0]?.item).toBe(
      "backing plaster",
    );
  });
});

describe("a bare count in front makes a price per-unit", () => {
  it("reads the count and the rate from the form with no trailing marker", () => {
    const [price] = extractStatedPrices("I need 8 bags of finish. 8 at £12 is the final figure.");

    expect(price?.amount).toBe(1200);
    expect(price?.quantity).toBe(8);
    expect(price?.qualifiers.each).toBe(true);
  });

  it("still reads the form that names its unit", () => {
    const [price] = extractStatedPrices("8 bags of finish at £12.");

    expect(price?.quantity).toBe(8);
    expect(price?.qualifiers.each).toBe(true);
  });

  it("does not reach across a clause into a neighbour's number", () => {
    // "…two tubs of primer at £27 each, and £88 for protection" must stay a
    // lump GBP 88, not two lots of it.
    const prices = extractStatedPrices(
      "Two tubs of primer at £27 each, and £88 for protection.",
    );
    const protection = prices.find((p) => p.amount === 8800);

    expect(protection?.qualifiers.each).toBe(false);
  });

  it("leaves a lump sum a lump sum where no count fronts it", () => {
    const [price] = extractStatedPrices("The material allowance is £96.");

    expect(price?.qualifiers.each).toBe(false);
    expect(price?.quantity ?? null).toBeNull();
  });
});
