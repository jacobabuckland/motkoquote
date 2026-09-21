/**
 * Scenario 41's money, end to end, on the words the contractor actually said.
 *
 * Five replays across two days have failed in four different places, and each
 * fix was judged against the piece it touched rather than against the quote.
 *
 * THIS FILE'S OWN FIRST VERSION IS THE CLEAREST CASE OF THAT. It was written
 * the day before to hold exactly this claim, and it passed against a tree that
 * could not price the real call, because its fixture was typed rather than
 * transcribed:
 *
 *   written here:   "8 at £12 is the final figure. One primer tub at £25"
 *   said on the call: "8 at 12 is the final figure. One primer tub at 25"
 *
 * A live transcription has no pound signs, and a bare number after "at" was
 * only read when the clause ENDED on it -- so both figures were dropped, one
 * on "as" and one on "is". It also used clean line descriptions where the
 * drafting model writes "Finishing plaster – 8 bags supplied by customer".
 * Neither shortcut was deliberate and both made the test weaker than its name.
 *
 * So: the transcript below is the transcription verbatim, and the drafts are
 * the line items the model wrote on job bf36a8f2. Anything sanitised here is a
 * defect this file cannot see.
 *
 * THE FOUR FAILURES, and where each is now pinned:
 *
 *  1. The count. "Sorry, make that 8 bags" filed under `bag`, so it never met
 *     the `finish = 10` it corrected (#849).
 *  2. The rate. "8 at 12" not read as per-unit (#849).
 *  3. Ownership. Intake put the materials on the customer -- first as
 *     `responsibility: "customer"`, then, after the reader for that landed, as
 *     an itemised "split" nobody itemised. Held at GBP 0 either way.
 *  4. Extraction. Both bare amounts dropped for the words behind them, which
 *     is the one that had survived all four earlier fixes.
 *
 * Each of 1, 3 and 4 alone is enough to fail the quote, so this asserts the
 * TOTAL as well as the parts: a passing part is not a passing quote, which is
 * the whole lesson of the five replays.
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

/** The contractor's audio, transcribed. No pound signs, because there are none. */
const SAID =
  "Quick draft for QA auto-test customer 41. Small wall skim, 20 square metres, " +
  "just me for one day at my saved rate. I need 10 bags of finish. Sorry, make that 8 bags. " +
  "They are 12 pounds each, not 11. 8 at 12 is the final figure. " +
  "One primer tub at 25 as well. These are customer prices before VAT with no markup. " +
  "Preparation and cleaning are included. No other materials, waste charge or extras. " +
  "Dates are not agreed. Just save the draft for me. Do not send it.";

const ctx: CompileContext = {
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
};

/** The line items the drafting model wrote, descriptions included. */
const drafted = (finishSuppliedBy: "contractor" | "customer"): DraftLineItem[] => [
  {
    kind: "material",
    description: "Finishing plaster – 8 bags supplied by customer",
    quantity: 8,
    unit: "bag",
    estimated_unit_cost_pence: 1200,
    supplied_by: finishSuppliedBy,
  },
  {
    kind: "material",
    description: "Primer / bonding agent – 1 tub",
    quantity: 1,
    unit: "tub",
    estimated_unit_cost_pence: 5000,
    supplied_by: "contractor",
  },
];

const compile = (finishSuppliedBy: "contractor" | "customer") =>
  compileDraftToLineItems(
    drafted(finishSuppliedBy),
    ctx,
    [],
    extractStatedPrices(SAID),
    extractStatedQuantities(SAID),
  );

const materialsTotal = (lines: { quantity: number; unit_price: number }[]) =>
  lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);

const finishLine = <T extends { description: string }>(lines: T[]): T =>
  lines.find((line) => line.description.startsWith("Finishing plaster"))!;
const primerLine = <T extends { description: string }>(lines: T[]): T =>
  lines.find((line) => line.description.startsWith("Primer"))!;

describe("both figures are heard as money", () => {
  it("finds three prices, not one", () => {
    // Before the tail rule, only "12 pounds each" survived -- the one sentence
    // with a currency word in it.
    expect(
      extractStatedPrices(SAID)
        .map((price) => price.amount)
        .sort((a, b) => a - b),
    ).toEqual([1200, 1200, 2500]);
  });

  it("reads the corrected count, not the one it replaced", () => {
    const counts = extractStatedQuantities(SAID);

    expect(counts).toHaveLength(1);
    expect(counts[0]?.item).toBe("finish");
    expect(counts[0]?.quantity).toBe(8);
  });
});

describe("the prices reach the lines they were said for", () => {
  it("charges eight bags at twelve pounds", () => {
    const finish = finishLine(compile("contractor").lineItems);

    expect(finish.quantity).toBe(8);
    expect(finish.unit_price).toBe(12);
    expect((finish as { unpriced?: boolean }).unpriced).toBeUndefined();
  });

  it("charges the primer at twenty five, not the GBP 50 it would have guessed", () => {
    const primer = primerLine(compile("contractor").lineItems);

    expect(primer.quantity).toBe(1);
    expect(primer.unit_price).toBe(25);
    expect((primer as { unpriced?: boolean }).unpriced).toBeUndefined();
  });

  it("comes to GBP 121 of materials, which with the day's labour is GBP 371", () => {
    const { lineItems } = compile("contractor");

    expect(materialsTotal(lineItems)).toBe(121);
    // The labour line has been right in every replay -- GBP 250 for the day --
    // so the quote's GBP 371 is these materials plus that.
    expect(materialsTotal(lineItems) + 250).toBe(371);
  });

  it("raises no flags at all on a quote that priced everything", () => {
    const { contractorFlags } = compile("contractor");

    expect(contractorFlags).toEqual([]);
  });

  it("does not tell the contractor a figure reached no line when it did", () => {
    // The rate is said twice, which is how a trade confirms a number. One
    // reaches the line; reporting the other as missing contradicts the line
    // beside it.
    const { contractorFlags } = compile("contractor");

    expect(
      contractorFlags.filter((flag) => flag.startsWith(UNATTACHED_STATED_PRICE_PREFIX)),
    ).toEqual([]);
  });
});

describe("the capture and the money are one chain", () => {
  /**
   * What intake returned on all three replays of 20 Sep: an itemised "split",
   * on a call where the contractor said nothing whatsoever about who buys.
   */
  const capturedSupply = {
    contractor_supplied: ["Primer"],
    customer_supplied: ["Finish"],
    responsibility: "split",
  } as unknown as MaterialsSupply;

  it("prices nothing while the finish is still the customer's", () => {
    // Not a defect in the compiler -- this is the correct rendering of a
    // material the customer buys, and it is why the wrong capture cost GBP 96.
    const finish = finishLine(compile("customer").lineItems);

    expect(finish.unit_price).toBe(0);
  });

  it("moves the finish off the customer and charges the full GBP 121", () => {
    const { supply, changes } = reconcileMaterialsSupply(capturedSupply, SAID);

    expect(supply.customer_supplied).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.because.toLowerCase()).toBe("customer prices");

    // What the drafter renders from that statement of work.
    const { lineItems } = compile(
      supply.customer_supplied.length === 0 ? "contractor" : "customer",
    );

    expect(materialsTotal(lineItems)).toBe(121);
  });

  it.each([
    [["Primer"], ["Finish"]],
    [[], ["10 bags of finish", "1 primer tub"]],
    [[], ["Finish", "Primer"]],
  ])("moves everything off the customer on replay %#", (contractorSupplied, customerSupplied) => {
    // The three replays captured three different shapes of the same mistake.
    const { supply } = reconcileMaterialsSupply(
      {
        contractor_supplied: contractorSupplied,
        customer_supplied: customerSupplied,
        responsibility: "split",
      } as unknown as MaterialsSupply,
      SAID,
    );

    expect(supply.customer_supplied).toEqual([]);
  });
});
