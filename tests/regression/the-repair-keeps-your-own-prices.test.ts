// Criterion 5 of #726, asserted somewhere it can actually fail.
//
// QA's finding on cycle 1 was right, and the Engineer agreed with it: the two
// frozen acceptance tests for the merge criteria verify nothing.
//
//   "preserves edited: true lines when re-pricing"
//     const editedLineDescription = "Replace consumer unit";
//     expect(editedLineDescription).toBe("Replace consumer unit");   ← a const
//                                                                     compared
//                                                                     with itself
//
//   "merges repair deltas into existing sow_json"
//     expect(result.jobId).toBe(jobId);   ← the id that was passed in
//
// Both pass whether the feature works or not, and both sit under
// tests/acceptance/, where nothing downstream may repair them. Arguing about
// that does not produce a test; this does. The rule they were supposed to
// protect is now a pure function, and these are the assertions the frozen file
// should have carried.
//
// What is NOT covered here, deliberately: criterion 6, "re-prices only the
// affected lines". The implementation redrafts every line and then restores the
// edited ones, so a line nobody touched can still move on model variability.
// That is a real gap and it is recorded on the item rather than papered over —
// writing a test that passes against the current behaviour would be worse than
// having none.
import { describe, expect, it } from "vitest";
import { preserveEditedLines } from "@/lib/preserve-edited-lines";
import type { LineItem } from "@/lib/schemas/job";

const line = (over: Partial<LineItem>): LineItem => ({
  description: "Replace consumer unit",
  category: "labour",
  quantity: 1,
  unit: "job",
  unit_price: 450,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...over,
});

describe("a repair keeps the price the contractor typed", () => {
  it("restores the edited price over the redrafted one", () => {
    // The contractor priced this at £620; the redraft came back with £450.
    const existing = [line({ unit_price: 620, edited: true })];
    const drafted = [line({ unit_price: 450 })];

    const result = preserveEditedLines(drafted, existing);

    expect(result[0]?.unit_price).toBe(620);
    expect(result[0]?.edited).toBe(true);
  });

  it("takes the redrafted price on a line nobody edited", () => {
    // Not edited, so the repair is allowed to re-price it. This is the half
    // that makes the test above mean something: if it passed too, the function
    // would simply be ignoring the redraft.
    const existing = [line({ unit_price: 620 })];
    const drafted = [line({ unit_price: 450 })];

    expect(preserveEditedLines(drafted, existing)[0]?.unit_price).toBe(450);
  });

  it("keeps everything else about the redrafted line", () => {
    // Only the PRICE is restored. A repair that changed the quantity or the
    // wording must still land — the contractor's mark protects what they set,
    // not the whole row as it was.
    const existing = [line({ unit_price: 620, edited: true, quantity: 1 })];
    const drafted = [line({ unit_price: 450, quantity: 3, unit: "day" })];

    const result = preserveEditedLines(drafted, existing);

    expect(result[0]?.quantity).toBe(3);
    expect(result[0]?.unit).toBe("day");
    expect(result[0]?.unit_price).toBe(620);
  });

  it("does not carry a price across categories", () => {
    // "Consumer unit" can legitimately appear once as labour and once as
    // materials. Matching on description alone would put the hand-set labour
    // price onto the materials line.
    const existing = [line({ category: "labour", unit_price: 620, edited: true })];
    const drafted = [line({ category: "materials", unit_price: 450 })];

    expect(preserveEditedLines(drafted, existing)[0]?.unit_price).toBe(450);
  });

  it("protects one edited line without touching its neighbours", () => {
    const existing = [
      line({ description: "Replace consumer unit", unit_price: 620, edited: true }),
      line({ description: "Second fix", unit_price: 300 }),
    ];
    const drafted = [
      line({ description: "Replace consumer unit", unit_price: 450 }),
      line({ description: "Second fix", unit_price: 380 }),
    ];

    const result = preserveEditedLines(drafted, existing);

    expect(result.map((l) => l.unit_price)).toEqual([620, 380]);
  });

  it("adds a line the repair introduced", () => {
    // A repair that captures new work must be able to add to the quote.
    const drafted = [line({}), line({ description: "Certificate", unit_price: 90 })];

    const result = preserveEditedLines(drafted, [line({ unit_price: 620, edited: true })]);

    expect(result).toHaveLength(2);
    expect(result[1]?.description).toBe("Certificate");
    expect(result[1]?.unit_price).toBe(90);
  });

  it("does NOT resurrect an edited line the repair dropped", () => {
    // The conversation changed the scope. A line that no longer belongs in the
    // quote should not come back because someone once typed a price into it.
    const existing = [line({ description: "Old scope", unit_price: 999, edited: true })];
    const drafted = [line({ description: "Replace consumer unit", unit_price: 450 })];

    const result = preserveEditedLines(drafted, existing);

    expect(result).toHaveLength(1);
    expect(result[0]?.description).toBe("Replace consumer unit");
  });

  it("is a plain redraft on a quote that had no lines", () => {
    const drafted = [line({ unit_price: 450 })];
    expect(preserveEditedLines(drafted, [])).toEqual(drafted);
  });
});
