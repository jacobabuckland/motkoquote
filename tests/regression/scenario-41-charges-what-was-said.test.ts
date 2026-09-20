/**
 * Scenario 41's money, end to end, on the words the contractor actually said.
 *
 * Three identical replays of this call have failed in three different places,
 * and each fix has been judged against the piece it touched rather than against
 * the quote. The last report was blunt about the cost of that:
 *
 *   "ownership is not yet proven to be the only remaining cause. In our third
 *    repeat, both materials were contractor-supplied, but finish remained
 *    unpriced: GBP 275 instead of GBP 371."
 *
 * So ownership being right is not the same claim as the money being right, and
 * this file holds the second claim on its own. It pins the two halves
 * separately and then together:
 *
 *  - PRICE ATTACHMENT, given ownership already correct. This is the failure the
 *    third replay found, and the one nothing had a bound test for: the finish
 *    line came out `quantity: 8, unit_price: 0, unpriced: true` with the GBP 12
 *    reported as reaching no line at all. #849 fixed the chain behind it -- a
 *    container read as the item's name, and "8 at GBP 12" read as a lump -- but
 *    that landed AFTER the replay that found this, so it has never been checked
 *    against the whole scenario.
 *  - THE JOIN, from what intake captured to what the customer is charged. The
 *    capture said the customer supplies; the correction moves it; the compiler
 *    then prices it. Either half alone passes while the quote is GBP 121 short.
 *
 * The drafting model sits between those two halves in production, so the join
 * here models what it does -- it renders `supplied_by` from the statement of
 * work -- rather than invoking it. That is the honest shape: what the model
 * writes cannot be pinned, what it is given and what is done with it can.
 */

import { describe, expect, it } from "vitest";
import {
  compileDraftToLineItems,
  UNATTACHED_STATED_PRICE_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import { reconcileMaterialsSupply } from "@/lib/voice/materials-ownership";
import type { DraftLineItem, MaterialsSupply } from "@/lib/schemas/job";

/** The contractor's half of scenario 41, verbatim in shape. */
const SAID =
  "I need 10 bags of finish. Sorry, make that 8 bags. They are £12 each, not £11. " +
  "8 at £12 is the final figure. One primer tub at £25 as well. " +
  "These are customer prices before VAT with no markup.";

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
  contractor_said: SAID,
  ...over,
});

/** What the drafting model writes for this call, bar who supplies it. */
const drafted = (suppliedBy: "contractor" | "customer"): DraftLineItem[] => [
  {
    kind: "material",
    description: "Finishing plaster",
    quantity: 1,
    unit: "bag",
    estimated_unit_cost_pence: 1200,
    supplied_by: suppliedBy,
  },
  {
    kind: "material",
    description: "Primer",
    quantity: 1,
    unit: "tub",
    estimated_unit_cost_pence: 2500,
    supplied_by: suppliedBy,
  },
];

const compile = (suppliedBy: "contractor" | "customer") =>
  compileDraftToLineItems(
    drafted(suppliedBy),
    ctx(),
    [],
    extractStatedPrices(SAID),
    extractStatedQuantities(SAID),
  );

const materialsTotal = (lines: { quantity: number; unit_price: number }[]) =>
  lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

describe("the prices reach the lines they were said for", () => {
  it("charges eight bags at twelve pounds, not eight bags at nothing", () => {
    const { lineItems } = compile("contractor");
    const finish = lineItems.find((line) => line.description === "Finishing plaster")!;

    // GBP 0 on a quantity of 8 was the third replay's failure: the count
    // reached the line and the rate did not.
    expect(finish.quantity).toBe(8);
    expect(finish.unit_price).toBe(12);
    expect((finish as { unpriced?: boolean }).unpriced).toBeUndefined();
  });

  it("charges the primer at twenty five", () => {
    const { lineItems } = compile("contractor");
    const primer = lineItems.find((line) => line.description === "Primer")!;

    expect(primer.quantity).toBe(1);
    expect(primer.unit_price).toBe(25);
    expect((primer as { unpriced?: boolean }).unpriced).toBeUndefined();
  });

  it("comes to GBP 121 of materials, which with the day's labour is GBP 371", () => {
    const { lineItems } = compile("contractor");

    expect(materialsTotal(lineItems)).toBe(121);
    // The labour line has been right in every replay -- GBP 250 for the day --
    // so the quote's GBP 371 is these materials plus that. Stated here because
    // the number the reports quote is the total, not the materials.
    expect(materialsTotal(lineItems) + 250).toBe(371);
  });

  it("does not tell the contractor a figure reached no line when it did", () => {
    const { contractorFlags } = compile("contractor");

    // The rate is said twice -- "they are GBP 12 each" and "8 at GBP 12 is the
    // final figure" -- which is how a trade confirms a number. One reaches the
    // line; reporting the other as missing contradicts the line beside it.
    expect(
      contractorFlags.filter((flag) => flag.startsWith(UNATTACHED_STATED_PRICE_PREFIX)),
    ).toEqual([]);
  });

  it("attributes both prices to the transcript, not to an estimate", () => {
    const { lineItems } = compile("contractor");

    for (const line of lineItems) {
      expect(line.assumed).toBe(false);
      expect(line.provenance?.source).toBe("transcript");
    }
  });
});

describe("the capture and the money are one chain", () => {
  /** What intake returned on all three replays. */
  const capturedSupply = {
    contractor_supplied: [],
    customer_supplied: [],
    responsibility: "customer",
  } as unknown as MaterialsSupply;

  it("prices nothing at all while the capture stands uncorrected", () => {
    // Not a defect in the compiler -- this is the correct rendering of a
    // material the customer buys, and it is why the wrong capture cost GBP 121.
    const { lineItems } = compile("customer");

    expect(materialsTotal(lineItems)).toBe(0);
  });

  it("charges the full GBP 121 once the capture is reconciled", () => {
    const { supply } = reconcileMaterialsSupply(capturedSupply, SAID);
    const responsibility = (supply as unknown as { responsibility?: string }).responsibility;

    expect(responsibility).toBe("contractor");

    // What the drafter renders from that statement of work.
    const { lineItems } = compile(responsibility === "contractor" ? "contractor" : "customer");

    expect(materialsTotal(lineItems)).toBe(121);
  });
});
