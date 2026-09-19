/**
 * "I need eight bags of finish" bills for eight bags, not one.
 *
 * #796 fixed this for a count stated BESIDE a price: "8 bags of finish at £12
 * each" extracts `quantity: 8` and the line charges 8 × £12. A count stated on
 * its own extracted nothing at all — the price extractor is a price extractor
 * — so it survived only as prose the intake model wrote into
 * `materials_supply.quantity_guidance` ("8 Finish bags at £12 each"), which
 * nothing downstream reads as a number. The drafting model puts such a count
 * in the line DESCRIPTION and leaves `quantity` at 1, so the customer is
 * billed for one bag of eight: the same undercharge, by the other road.
 *
 * The restraint cases below matter as much as the action ones. This multiplies
 * a line total, so every way it could attach to the wrong line, or fight a
 * number somebody actually gave, is a way to overcharge a customer.
 */

import { describe, expect, it } from "vitest";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import {
  compileDraftToLineItems,
  STATED_QUANTITY_PREFIX,
  type CompileContext,
} from "@/lib/compile-draft";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";

const ctx: CompileContext = {
  day_rate: 300,
  overtime_rate: null,
  markup_pct: 0,
  team_members: [],
  rate_cards: [],
  known_material_prices: [],
  owner_label: "Owner",
  has_pricing_history: true,
  labour_plan: { people_count: 1, duration_days: 2, crew_description: null },
};

const material = (
  description: string,
  overrides: Partial<Extract<DraftLineItem, { kind: "material" }>> = {},
): DraftLineItem => ({
  kind: "material",
  description,
  quantity: 1,
  unit: "bag",
  estimated_unit_cost_pence: 1200,
  supplied_by: "contractor",
  ...overrides,
});

const lineFor = (description: string, drafts: DraftLineItem[], transcript: string, prices: StatedPrice[] = []) => {
  const result = compileDraftToLineItems(
    drafts,
    ctx,
    [],
    prices,
    extractStatedQuantities(transcript),
  );
  return {
    line: result.lineItems.find((l) => l.description === description),
    flags: result.contractorFlags,
  };
};

describe("a count with no price beside it", () => {
  it("is read from the transcript at all", () => {
    expect(extractStatedQuantities("I need eight bags of finish")).toEqual([
      {
        item: "finish",
        quantity: 8,
        unit: "bag",
        transcript_span: "I need eight bags of finish",
      },
    ]);
  });

  it("reaches the line the contractor was being undercharged on", () => {
    const { line } = lineFor(
      "Finishing plaster (eight bags)",
      [material("Finishing plaster (eight bags)")],
      "I need eight bags of finish for the bedrooms",
    );

    expect(line?.quantity).toBe(8);
  });

  it("is said out loud, with the words that moved it", () => {
    const { flags } = lineFor(
      "Finishing plaster (eight bags)",
      [material("Finishing plaster (eight bags)")],
      "I need eight bags of finish for the bedrooms",
    );

    const flag = flags.find((f) => f.startsWith(STATED_QUANTITY_PREFIX));
    expect(flag).toContain("eight bags of finish");
    expect(flag).toContain("was drafted at 1");
  });

  it("reads a compound count whole, rather than its last word", () => {
    // "twenty-six" read as six undercharged by two thirds, silently — the
    // failure compoundCount's own comment records.
    expect(extractStatedQuantities("I need twenty-six bags of bonding")[0]?.quantity).toBe(26);
  });
});

describe("what it refuses, because a wrong count is worse than an absent one", () => {
  it("leaves a sentence that states money to the price extractor", () => {
    // Not a gap: this phrasing already works, and two readers over one sentence
    // is how they come to disagree.
    const priced = "I need 8 bags of finish at £12 each";
    expect(extractStatedQuantities(priced)).toEqual([]);
    expect(extractStatedPrices(priced)[0]?.quantity).toBe(8);
  });

  it("drops a count that contradicts itself", () => {
    // Eight for the walls and four for the ceiling means twelve, and no rule
    // here can know that.
    expect(
      extractStatedQuantities(
        "eight bags of finish for the walls, four bags of finish for the ceiling",
      ),
    ).toEqual([]);
  });

  it("does not read a cancelled or hypothetical count", () => {
    expect(extractStatedQuantities("We won't need eight bags of finish")).toEqual([]);
    expect(extractStatedQuantities("If it's eight bags of finish I'll let you know")).toEqual([]);
  });

  it("does not read a unit of measure as a count of materials", () => {
    // "40 square metres of plasterboard" is the area of the WORK far more often
    // than a count of boards, and multiplying a line by 40 is the expensive
    // direction to be wrong in.
    expect(extractStatedQuantities("about 40 square metres of plasterboard")).toEqual([]);
  });

  it("never overrides a count the draft already gave", () => {
    // 1 is the model's "didn't bother" value; 3 is a real answer and outranks
    // anything inferred here.
    const { line, flags } = lineFor(
      "Finishing plaster",
      [material("Finishing plaster", { quantity: 3 })],
      "I need eight bags of finish",
    );

    expect(line?.quantity).toBe(3);
    expect(flags.some((f) => f.startsWith(STATED_QUANTITY_PREFIX))).toBe(false);
  });

  it("attaches to nothing when two lines both answer to it", () => {
    // The ambiguity rule #793 applies to prices: a count matching two lines
    // names neither, and picking the first is a coin toss with real money.
    const { line, flags } = lineFor(
      "Finishing plaster — bedrooms",
      [material("Finishing plaster — bedrooms"), material("Finishing plaster — hallway")],
      "I need eight bags of finish",
    );

    expect(line?.quantity).toBe(1);
    expect(flags.some((f) => f.startsWith(STATED_QUANTITY_PREFIX))).toBe(false);
  });

  it("does not multiply a labour line", () => {
    const labour: DraftLineItem = {
      kind: "labour",
      description: "Plastering labour — eight bags of finish to hang",
      people: [{ ref: "owner", days: 2 }],
      overtime: false,
      includes_tasks: [],
    };
    const description = "Plastering labour — eight bags of finish to hang";
    const { line, flags } = lineFor(description, [labour], "I need eight bags of finish");
    const untouched = compileDraftToLineItems([labour], ctx, [], [], []).lineItems.find(
      (l) => l.description === description,
    );

    // A labour line's quantity is its DAYS, so the claim is that the count did
    // not reach it — not that it sits at 1.
    expect(line?.quantity).toBe(untouched?.quantity);
    expect(flags.some((f) => f.startsWith(STATED_QUANTITY_PREFIX))).toBe(false);
  });

  it("leaves a line the transcript already priced alone", () => {
    // applyStatedPrice settled that line's count with more evidence than this
    // has. Two writers on one number is how they come to disagree.
    const statedPrice: StatedPrice = {
      amount: 1200,
      item: "finish",
      quantity: 6,
      caps_item: null,
      transcript_span: "six bags of finish at twelve pounds each",
      qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
      superseded_by: null,
      refused: false,
    };
    const { line } = lineFor(
      "Finishing plaster",
      [material("Finishing plaster")],
      "I need eight bags of finish",
      [statedPrice],
    );

    expect(line?.quantity).toBe(6);
  });
});
