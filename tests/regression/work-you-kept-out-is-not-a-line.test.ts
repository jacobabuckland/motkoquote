/**
 * Work the contractor kept out of the price does not sit in the price table.
 *
 * An option the customer is still choosing between, or work to be quoted
 * separately, arrives from the drafting model as an ordinary line. There is no
 * price behind it — there is none to have — so it lands `unpriced`, and an
 * unpriced line stops the quote being accepted at all (UNPRICED_ACCEPT_REFUSED).
 *
 * Voice run 16 carried three of them: Option A, Option B and a curtain track,
 * all recorded in `assumptions_and_unknowns` as `provisional_sum`. Run 20's
 * cornice was the same. In both cases the quote could not be accepted because
 * of work explicitly NOT in it — and the treatment had been captured correctly
 * every time. It simply never reached the decision about whether the item is a
 * payable line.
 *
 * Only an unpriced line is ever eligible, so no total can move whatever this
 * decides, and a labour line is never eligible — see MIN_SHARED_SCOPE_STEMS for
 * the measurement behind that.
 */

import { describe, expect, it } from "vitest";
import { describesOutOfScopeWork } from "@/lib/compile-draft";
import { outOfScopeNotes } from "@/lib/schemas/sow";

const RUN_16_NOTES = [
  "Customer has not yet chosen between Option A (skim remaining ceiling) or Option B (overboard and skim whole ceiling)",
  "Curtain track removal and refit is not yet chosen",
];

const RUN_20_NOTES = [
  "Acoustic ceiling option removed",
  "Taking down and refitting the existing cornice (£320 plus VAT) to be priced separately",
];

describe("work you kept out is not a line", () => {
  it("recognises the options run 16 could not be accepted for", () => {
    for (const description of [
      "Option A: Skim remaining bedroom ceiling (existing plasterboard retained, skim coat only)",
      "Option B: Overboard and skim whole bedroom ceiling (new plasterboard fixed over existing, then skimmed)",
      "Curtain track removal and refit",
    ]) {
      expect(describesOutOfScopeWork(description, RUN_16_NOTES), description).not.toBeNull();
    }
  });

  it("recognises run 20's separately-quoted cornice", () => {
    expect(
      describesOutOfScopeWork("Take down and refit existing cornice – community room", RUN_20_NOTES),
    ).not.toBeNull();
  });

  it("never touches the labour line, which is the job itself", () => {
    // Measured, not assumed: at a two-word threshold this matched the Option A
    // and Option B note on "skim" and "ceiling", and dropping the labour line
    // is the worst thing this could do.
    expect(
      describesOutOfScopeWork(
        "Plastering labour – prep and skim 96 square metres of walls and patch 12 square metres of ceiling in bedroom",
        RUN_16_NOTES,
      ),
    ).toBeNull();
  });

  it("leaves a line that is simply unpriced still blocking", () => {
    // Run 17's waste removal shares "ceiling" with an exclusion about the
    // ceiling and nothing else. Nobody priced it, so it must keep blocking.
    expect(
      describesOutOfScopeWork("Waste removal and disposal of ceiling debris arising from opening up", [
        "Cost of repairs after investigation is assumed excluded and will be quoted separately after inspection.",
      ]),
    ).toBeNull();

    // Run 20's materials, against run 20's own notes.
    expect(
      describesOutOfScopeWork(
        "Finishing plaster (multi-finish) – 28 bags for walls, ceiling, and reveals",
        RUN_20_NOTES,
      ),
    ).toBeNull();
  });

  it("drops nothing when the statement of work named nothing", () => {
    expect(describesOutOfScopeWork("Curtain track removal and refit", [])).toBeNull();
    expect(describesOutOfScopeWork("Curtain track removal and refit", null)).toBeNull();
  });
});

describe("which treatments put work outside the quote", () => {
  it("takes excluded and provisional_sum, and leaves assumed_ok alone", () => {
    const notes = outOfScopeNotes({
      assumptions_and_unknowns: [
        { description: "Acoustic ceiling option removed", treatment: "excluded" },
        { description: "Cornice to be priced separately", treatment: "provisional_sum" },
        // In the quote, merely caveated — it must keep its line.
        { description: "Assumes the floor is sound under the units", treatment: "assumed_ok" },
      ],
    });

    expect(notes).toEqual([
      "Acoustic ceiling option removed",
      "Cornice to be priced separately",
    ]);
  });
});
