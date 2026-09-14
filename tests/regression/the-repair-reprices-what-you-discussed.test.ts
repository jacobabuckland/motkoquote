// Criterion 6 of #726, asserted somewhere it can actually fail.
//
// TWO THINGS ARE PINNED HERE, and the item spent three review cycles because
// they pull in opposite directions:
//
//   * A repair that captures the real crew size MUST re-price the labour. If
//     nothing re-prices, the quote keeps a figure the model guessed while the
//     SoW now says otherwise — and the repair was for nothing. (QA cycle 3.)
//
//   * A repair that captures the crew size must NOT move the materials lines.
//     Those were not discussed; the redraft returning a different number for
//     them is model variability, and a contractor watching figures change on
//     lines nobody mentioned is the defect QA named in cycle 1.
//
// The rule that satisfies both reads the answer off the redraft: a line's
// inputs changed exactly when one of its own pricing inputs moved. Everything
// else keeps the price the quote already carried, and a hand-edited price
// outranks both.
//
// The frozen acceptance test for this criterion asserts nothing —
//
//   const editedLineDescription = "Replace consumer unit";
//   expect(editedLineDescription).toBe("Replace consumer unit");   // a const,
//                                                                  // compared
//                                                                  // with itself
//
// — and a frozen file cannot be repaired, so the assertions that matter live
// here.
import { describe, expect, it } from "vitest";
import { applySelectiveReprice } from "@/lib/selective-reprice";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Replace consumer unit",
  category: "labour",
  quantity: 1,
  unit: "day",
  unit_price: 450,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

describe("a line the conversation touched IS re-priced", () => {
  it("takes the new price when the crew size moved", () => {
    // The repair captured "two of us", so the labour line's people_count moved.
    // Skipping re-pricing entirely leaves the quote priced for one person on a
    // two-person job — which is what cycle 3 objected to.
    const stored = [line({ people_count: 1, unit_price: 450 })];
    const drafted = [line({ people_count: 2, unit_price: 900 })];

    expect(applySelectiveReprice(drafted, stored)[0]?.unit_price).toBe(900);
  });

  it("takes the new price when the duration moved", () => {
    const stored = [line({ quantity: 2, unit_price: 450 })];
    const drafted = [line({ quantity: 5, unit_price: 520 })];

    const result = applySelectiveReprice(drafted, stored);
    expect(result[0]?.quantity).toBe(5);
    expect(result[0]?.unit_price).toBe(520);
  });

  it("takes the new price when the unit, overtime or multiplier moved", () => {
    for (const moved of [{ unit: "hour" }, { overtime: true }, { multiplier: 1.5 }]) {
      const result = applySelectiveReprice(
        [line({ ...moved, unit_price: 700 })],
        [line({ unit_price: 450 })],
      );
      expect(result[0]?.unit_price, JSON.stringify(moved)).toBe(700);
    }
  });
});

describe("a line the conversation did NOT touch keeps its price", () => {
  it("ignores a redraft that moved only the number", () => {
    // Every input identical; only unit_price differs. That is the model
    // returning a different answer to the same question, and suppressing it is
    // the whole point of the criterion.
    const stored = [line({ category: "materials", description: "Cable", unit_price: 185 })];
    const drafted = [line({ category: "materials", description: "Cable", unit_price: 210 })];

    expect(applySelectiveReprice(drafted, stored)[0]?.unit_price).toBe(185);
  });

  it("holds materials steady while the labour line re-prices", () => {
    // Both halves of the criterion in one assertion: the repair captured crew
    // information, labour moves because its inputs moved, materials does not.
    const stored = [
      line({ description: "Rewire", people_count: 1, unit_price: 450 }),
      line({ description: "Cable", category: "materials", unit_price: 185 }),
    ];
    const drafted = [
      line({ description: "Rewire", people_count: 2, unit_price: 900 }),
      line({ description: "Cable", category: "materials", unit_price: 210 }),
    ];

    expect(applySelectiveReprice(drafted, stored).map((l) => l.unit_price)).toEqual([900, 185]);
  });
});

describe("a hand-edited price outranks both", () => {
  it("survives even when the inputs moved", () => {
    // The contractor priced this themselves. A repair may change the shape of
    // the line, but not the figure they set.
    const stored = [line({ people_count: 1, unit_price: 620, edited: true })];
    const drafted = [line({ people_count: 2, unit_price: 900 })];

    const result = applySelectiveReprice(drafted, stored);
    expect(result[0]?.unit_price).toBe(620);
    expect(result[0]?.edited).toBe(true);
    // The rest of the redraft still lands — only the price is protected.
    expect(result[0]?.people_count).toBe(2);
  });

  it("does not carry a price across categories", () => {
    // "Consumer unit" can legitimately appear once as labour and once as
    // materials. Matching on description alone would move one line's hand-set
    // price onto the other.
    const stored = [line({ category: "labour", unit_price: 620, edited: true })];
    const drafted = [line({ category: "materials", unit_price: 450 })];

    expect(applySelectiveReprice(drafted, stored)[0]?.unit_price).toBe(450);
  });
});

describe("lines the repair added or dropped", () => {
  it("adds a line the repair introduced, at its drafted price", () => {
    const drafted = [line({}), line({ description: "Certificate", unit_price: 90 })];

    const result = applySelectiveReprice(drafted, [line({ unit_price: 620, edited: true })]);

    expect(result).toHaveLength(2);
    expect(result[1]?.unit_price).toBe(90);
  });

  it("does NOT resurrect an edited line the repair dropped", () => {
    // The conversation changed the scope. A price once typed is not a reason to
    // re-add work that no longer belongs in the quote.
    const stored = [line({ description: "Old scope", unit_price: 999, edited: true })];
    const drafted = [line({ description: "Replace consumer unit", unit_price: 450 })];

    const result = applySelectiveReprice(drafted, stored);
    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Replace consumer unit");
  });

  it("is a plain redraft on a quote that had no lines", () => {
    const drafted = [line({ unit_price: 450 })];
    expect(applySelectiveReprice(drafted, [])).toEqual(drafted);
  });
});
