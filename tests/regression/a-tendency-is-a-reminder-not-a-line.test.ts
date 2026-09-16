/**
 * A tendency tells the contractor something. It does not add a line.
 *
 * `summarizeTendencies` turns a contractor's past edits into prompt statements.
 * The "added" one read "consider including it upfront", and the drafting model
 * obliged: scrim tape, waste removal and protective sheeting appeared on 8 of
 * the 12 quotes in the 16 Sep tranche — 17 lines in all — including on jobs
 * where the contractor had said there were no other charges. Five of those runs
 * also raised an `Unsourced line` flag because of them, which blocks the send.
 * A feature meant to save the contractor work was costing them a sendable quote.
 *
 * Jacob's call, 16 Sep: a tendency is a prompt TO THE CONTRACTOR and never a
 * line on a customer's quote. The accepted cost is that someone who always adds
 * waste removal now has to remember it — with a flag in front of them saying so.
 *
 * The "removed" tendency is untouched. Leaving a line OUT cannot invent a
 * charge, so it was never the problem.
 */

import { describe, expect, it } from "vitest";
import { summarizeTendencies } from "@/lib/quote-learning";

type Edit = Parameters<typeof summarizeTendencies>[0][number];

const edit = (overrides: Partial<Edit>): Edit =>
  ({
    edit_type: "added",
    description: "Waste removal and disposal",
    normalized_description: "waste removal and disposal",
    category: "other",
    drafted_unit_price: null,
    final_unit_price: null,
    ...overrides,
  }) as Edit;

const addedThreeTimes = [edit({}), edit({}), edit({})];

describe("a line the contractor keeps adding", () => {
  const [tendency] = summarizeTendencies(addedThreeTimes);

  it("is reported at all", () => {
    expect(tendency, "the learning itself is still worth having").toBeDefined();
    expect(tendency).toContain("Waste removal and disposal");
  });

  it("tells the model NOT to put it on the quote", () => {
    expect(tendency).toMatch(/do not add that line/i);
  });

  it("sends it to the contractor instead", () => {
    expect(tendency).toMatch(/contractor_flag/i);
  });

  it("no longer invites the model to include it", () => {
    // The exact wording that produced 17 unasked-for lines.
    expect(tendency).not.toMatch(/consider including it upfront/i);
  });
});

describe("a line the contractor keeps removing", () => {
  it("still tells the model to leave it out", () => {
    // Untouched, and deliberately so: omitting a line cannot invent a charge.
    const [tendency] = summarizeTendencies([
      edit({ edit_type: "removed" }),
      edit({ edit_type: "removed" }),
      edit({ edit_type: "removed" }),
    ]);

    expect(tendency).toMatch(/consider leaving it out/i);
  });
});

describe("a tendency about PRICE rather than presence", () => {
  it("is untouched, because it changes a line that already exists", () => {
    const priced = Array.from({ length: 3 }, () =>
      edit({ edit_type: "modified", drafted_unit_price: 100, final_unit_price: 130 }),
    );
    const [tendency] = summarizeTendencies(priced);

    expect(tendency).toMatch(/typically prices/i);
    expect(tendency).not.toMatch(/do not add that line/i);
  });
});
