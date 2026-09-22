/**
 * Scenario 41 shipped GBP 84 short, and the reason was not the one the report
 * named.
 *
 * Its diagnosis was an item-identity leak -- "a GBP 12 lump amount with item
 * identity 8" -- and #837 fixed that. Run the scenario's shape through the
 * tree afterwards and it is still GBP 84 short, on a sentence where BOTH name
 * readers come out clean:
 *
 *   "Eight bags of finish and one tub of primer.
 *    Finish is twelve pounds a bag, primer is twenty five pounds."
 *
 *   price items: ["Finish", "primer"]      count items: ["finish", "primer"]
 *   -> 1 bag x GBP 12 + 1 tub x GBP 25 = GBP 37, against GBP 121
 *
 * THE COUNT AND THE RATE WERE SAID IN DIFFERENT SENTENCES, which is how a
 * trade actually speaks: the materials first, the prices after. Both were read
 * correctly. The count was then REFUSED, because the stated-quantity guard
 * stood down on any line already priced from the transcript, on the stated
 * grounds that "a stated price has already settled that line's count".
 *
 * A price settles a count only when it carried one. "Finish is twelve pounds a
 * bag" settles the RATE and says nothing about how many bags. So the guard
 * deferred to evidence that did not exist, and the line stayed at one.
 *
 * Nothing is lost by narrowing it. A price that DID carry a count leaves the
 * line at that count, so condition 2 has already stood the guard down -- which
 * this pins, because that is the protection the old wording was reaching for.
 *
 * Two smaller defects on the same shape, both of which strand a count:
 *
 *  - "8 at GBP 12 each" -- #837 rightly refused to let that bare 8 be the
 *    item's NAME, then discarded it. Item-less had a meaning for SUPERSESSION
 *    (adopted into the nearest group by proximity) and none for ATTACHING TO A
 *    LINE, where `matchStatedPriceByItem` skips an item-less price outright.
 *    Grouping is not attachment. The GBP 12 reached no line at all.
 *  - "8 bags of Finish, 1 tub of Primer" stored the count's item as
 *    `Finish 1`. The comma is gone by the time the words are read, so the next
 *    clause's count walked into the name and nothing matched it.
 */

import { describe, expect, it } from "vitest";
import { compileDraftToLineItems, type CompileContext } from "@/lib/compile-draft";
import {
  bareCountBefore,
  extractStatedPrices,
} from "@/lib/voice/stated-prices";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import type { DraftLineItem } from "@/lib/schemas/job";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { StatedQuantity } from "@/lib/voice/stated-quantities";

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
  ...over,
});

const finishAndPrimer: DraftLineItem[] = [
  {
    kind: "material",
    description: "Finishing plaster",
    quantity: 1,
    unit: "bag",
    estimated_unit_cost_pence: 1200,
    supplied_by: "contractor",
  },
  {
    kind: "material",
    description: "Primer",
    quantity: 1,
    unit: "tub",
    estimated_unit_cost_pence: 2500,
    supplied_by: "contractor",
  },
];

/** Compile a transcript end to end, the way `draftQuote` does. */
const fromTranscript = (transcript: string, drafts = finishAndPrimer) =>
  compileDraftToLineItems(
    drafts,
    ctx({ contractor_said: transcript }),
    [],
    extractStatedPrices(transcript),
    extractStatedQuantities(transcript),
  );

const total = (lines: { quantity: number; unit_price: number }[]) =>
  lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);

const price = (over: Partial<StatedPrice> = {}): StatedPrice => ({
  amount: 1200,
  item: null,
  quantity: 8,
  caps_item: null,
  transcript_span: "8 at £12 each",
  qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
  superseded_by: null,
  refused: false,
  ...over,
});

const count = (over: Partial<StatedQuantity> = {}): StatedQuantity => ({
  item: "finish",
  quantity: 8,
  unit: "bag",
  transcript_span: "eight bags of finish",
  ...over,
});

describe("a count and a rate said in different sentences still meet", () => {
  it("charges eight bags, not one, when the rate came after the count", () => {
    const { lineItems } = fromTranscript(
      "Eight bags of finish and one tub of primer. " +
        "Finish is twelve pounds a bag, primer is twenty five pounds.",
    );

    // GBP 37 was the defect: 1 x 12 + 1 x 25.
    expect(total(lineItems)).toBe(121);
  });

  it("puts the count on the line rather than leaving it at the model's 1", () => {
    const { lineItems } = fromTranscript(
      "Eight bags of finish and one tub of primer. " +
        "Finish is twelve pounds a bag, primer is twenty five pounds.",
    );
    const finish = lineItems.find((l) => l.description === "Finishing plaster")!;

    expect(finish.quantity).toBe(8);
    expect(finish.unit_price).toBe(12);
  });

  it("does the same when the counts are in digits and split by a comma", () => {
    const { lineItems } = fromTranscript(
      "8 bags of Finish, 1 tub of Primer. The finish is £12 a bag and the primer is £25.",
    );

    expect(total(lineItems)).toBe(121);
  });

  it("still stands down where the PRICE carried the count itself", () => {
    // The protection the old wording was reaching for, and it survives on
    // condition 2 alone: a price carrying eight leaves the line at eight, so
    // the guard never looks at it and cannot apply a second count.
    const { lineItems } = compileDraftToLineItems(
      [finishAndPrimer[0]!],
      ctx(),
      [],
      [price({ item: "finish" })],
      [count({ quantity: 3 })],
    );

    expect(lineItems[0]!.quantity).toBe(8);
    expect(total(lineItems)).toBe(96);
  });
});

describe("an item-less per-unit price takes its name from the count it agrees with", () => {
  it("reaches the line the contractor was counting back to", () => {
    const { lineItems } = fromTranscript(
      "I need 8 bags of finish and a tub of primer. 8 at £12 each. Primer is £25 a tub.",
    );

    expect(total(lineItems)).toBe(121);
  });

  it("reads the bare count that #837 refused to read as a name", () => {
    const [extracted] = extractStatedPrices("I need 8 bags of finish. 8 at £12 each");

    expect(extracted?.item).toBeNull();
    expect(extracted?.quantity).toBe(8);
  });

  it("refuses when two materials were counted the same", () => {
    // Guessing between them is how a price lands on the wrong material.
    const { lineItems } = compileDraftToLineItems(
      finishAndPrimer,
      ctx(),
      [],
      [price()],
      [count(), count({ item: "primer", unit: "tub" })],
    );

    expect(total(lineItems)).toBe(0);
  });

  it("refuses on a count of one, which agrees with almost anything", () => {
    const { lineItems } = compileDraftToLineItems(
      [finishAndPrimer[1]!],
      ctx(),
      [],
      [price({ amount: 2500, quantity: 1 })],
      [count({ item: "primer", quantity: 1, unit: "tub" })],
    );

    expect(lineItems[0]!.unit_price).toBe(0);
  });

  it("never redirects a price that named something itself", () => {
    const { lineItems } = compileDraftToLineItems(
      finishAndPrimer,
      ctx(),
      [],
      [price({ item: "primer", amount: 2500 })],
      [count()],
    );
    const primer = lineItems.find((l) => l.description === "Primer")!;
    const finish = lineItems.find((l) => l.description === "Finishing plaster")!;

    expect(primer.unit_price).toBe(25);
    expect(finish.unpriced).toBe(true);
  });

  it("never lets a lump sum adopt a count", () => {
    const { lineItems } = compileDraftToLineItems(
      [finishAndPrimer[0]!],
      ctx(),
      [],
      [price({ qualifiers: { each: false, fitted: false, already_paid: false, excluded: false } })],
      [count()],
    );

    expect(lineItems[0]!.unpriced).toBe(true);
  });
});

describe("bareCountBefore reads only its own clause", () => {
  it("reads the count in the shape that has no unit", () => {
    expect(bareCountBefore("I need 8 bags of finish. 8 at ")).toBe(8);
    expect(bareCountBefore("eight at ")).toBe(8);
  });

  it("reads a compound written as words", () => {
    expect(bareCountBefore("twenty-six at ")).toBe(26);
  });

  it("does not read across a comma into a neighbour's number", () => {
    expect(bareCountBefore("primer is £25, at ")).toBeNull();
    expect(bareCountBefore("8 bags of finish and at ")).toBeNull();
  });

  it("says nothing where the number is not joined by 'at'", () => {
    expect(bareCountBefore("8 bags of finish ")).toBeNull();
    expect(bareCountBefore("the finish is ")).toBeNull();
  });
});

describe("a bare number never becomes part of a material's name", () => {
  it("stops the next clause's count joining the name", () => {
    const read = extractStatedQuantities("8 bags of Finish, 1 tub of Primer");

    expect(read.map((q) => q.item)).toEqual(["Finish", "Primer"]);
  });

  it("leaves a name that merely contains digits alone", () => {
    // The rule is that a name may not BE a number, not that digits disqualify.
    // The dot is already gone by this point -- the reader strips punctuation
    // from each word before matching -- so the name keeps its digit-bearing
    // word in the stripped form rather than losing it. Pinned as it is, not as
    // it reads aloud: that normalisation is older than this change and
    // separate from it.
    const read = extractStatedQuantities("I need 12 sheets of 12.5mm plasterboard");

    expect(read[0]?.item).toBe("125mm plasterboard");
    expect(read[0]?.quantity).toBe(12);
  });
});
