/**
 * The assistant does not promise a reduction it cannot make.
 *
 * On voice run 18 the contractor offered the customer £80 off as a goodwill
 * gesture and the assistant said it would take it off. Nothing downstream can:
 * the quote has no discount field, a negative line is refused on purpose (the
 * one shape that would let a model-invented material arrive at minus £500 —
 * recorded in areas/motko.md, 15 Sep), and where a reduction may come FROM is a
 * queued decision. The quote came out at the undiscounted £1,921.40 with no
 * mention that anything had been dropped.
 *
 * That is the worst shape a wrong answer can take here, because it is the one
 * the contractor cannot catch: it was said out loud and never written down.
 * Until a discount exists, the honest answer is to record it where they will
 * see it and say so.
 *
 * The instruction string IS the behaviour under test — it is what the model is
 * given — so this asserts on what the builder returns, not on how the file that
 * builds it is written.
 */

import { describe, expect, it } from "vitest";
import { buildJobIntakeInstructions } from "@/lib/voice/job-intake-prompt";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";

const EVERY_SHAPE_OF_INTAKE = [
  { label: "signed-in", options: { firstName: "Jake", includeAccountTools: true } },
  { label: "guest", options: {} },
  { label: "first job", options: { isFirstJob: true, hasDayRate: false } },
  // A contractor filling gaps in an existing quote can offer a discount just as
  // easily, and that session builds its instructions down a separate path.
  { label: "repair", options: { existingSow: EMPTY_SOW_STATE } },
];

describe("Motko does not promise to subtract", () => {
  for (const { label, options } of EVERY_SHAPE_OF_INTAKE) {
    it(`tells the ${label} session it cannot apply one`, () => {
      const instructions = buildJobIntakeInstructions(options);

      expect(instructions).toContain("cannot apply a discount");
      expect(instructions).toContain("never say");
    });

    it(`tells the ${label} session where to put it instead`, () => {
      const instructions = buildJobIntakeInstructions(options);

      expect(instructions).toContain("assumptions_and_unknowns");
      // And that the contractor, in the call, is told they apply it themselves.
      expect(instructions).toContain("note for them to apply");
    });
  }
});
