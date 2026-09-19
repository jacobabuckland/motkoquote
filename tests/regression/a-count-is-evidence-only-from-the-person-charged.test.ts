/**
 * What the 19 Sep tranche of 15 found, reproduced from its own evidence.
 *
 * Both defects hid behind a correct final total, which is why they are worth
 * pinning: the draft came out right and the STORED capture was malformed, so
 * the guard looked like it was working while its safeguards were inert.
 *
 * 1. THE ITEM NAME LEAKED, AND THAT DEFEATED THE RULES KEYED ON IT.
 *    Scenario 204 persisted `finish actually make` = 8 beside `finish` = 10;
 *    scenario 202 persisted `backing plaster just` = 6 beside `backing
 *    plaster` = 6. The conflict and duplicate checks both key on the item
 *    name, so one leaked word splits a material into two identities and
 *    neither check fires. #828 claimed conflicting counts cancel; on the
 *    evidence of 204 they never met.
 *
 * 2. THE ASSISTANT'S READBACK COUNTED AS THE CONTRACTOR'S WORDS.
 *    202's duplicate six came from Motko repeating the number back. Worse
 *    than a duplicate: an assistant that mishears reads the WRONG number
 *    back, and it would arrive indistinguishable from the contractor's own.
 *
 * And the question #828 deliberately left open, which this tranche answered:
 * "eight bags of finish, actually make it ten" must resolve to ten, not
 * cancel. Cancelling leaves the line at 1 having been told the answer.
 */

import { describe, expect, it } from "vitest";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import type { TranscriptTurn } from "@/lib/voice-transcript";

const turn = (speaker: TranscriptTurn["speaker"], text: string, at: string): TranscriptTurn =>
  ({ speaker, text, at });

describe("the item name is the material, and nothing after it", () => {
  it("does not let a correction phrase into the name (scenario 204)", () => {
    const read = extractStatedQuantities(
      "I need eight bags of finish, actually make it ten bags of finish",
    );

    expect(read.map((q) => q.item)).toEqual(["finish"]);
  });

  it("does not let a filler word into the name (scenario 202)", () => {
    const read = extractStatedQuantities(
      "I need six bags of backing plaster. Just six bags of backing plaster, got it.",
    );

    expect(read.map((q) => q.item)).toEqual(["backing plaster"]);
  });

  it("keeps a two-word material whole", () => {
    expect(extractStatedQuantities("I need six bags of backing plaster")[0]?.item).toBe(
      "backing plaster",
    );
  });
});

describe("a count is evidence only from the person being charged", () => {
  it("ignores the assistant reading the number back", () => {
    const read = extractStatedQuantities("unused when turns are valid", [
      turn("contractor", "I need six bags of backing plaster", "2026-09-19T14:00:01Z"),
      turn("assistant", "Just six bags of backing plaster, got it.", "2026-09-19T14:00:02Z"),
    ]);

    expect(read).toHaveLength(1);
    expect(read[0]?.transcript_span).toBe("I need six bags of backing plaster");
  });

  it("never takes a number the contractor did not say", () => {
    // The case that makes this a money rule rather than a tidiness one: an
    // assistant that mishears reads the WRONG count back.
    const read = extractStatedQuantities("unused", [
      turn("contractor", "I need six bags of backing plaster", "2026-09-19T14:00:01Z"),
      turn("assistant", "Sixteen bags of backing plaster, got it.", "2026-09-19T14:00:02Z"),
    ]);

    expect(read.map((q) => q.quantity)).toEqual([6]);
  });

  it("falls back to the flat transcript when turns are absent or legacy-shaped", () => {
    // Legacy July-2026 turns carry no `at`, which is what turnsAreValid tests
    // and how the price extractor behaves on the same input.
    const legacy = [{ speaker: "contractor", text: "I need eight bags of finish" }];
    expect(
      extractStatedQuantities("I need eight bags of finish", legacy as TranscriptTurn[])[0]
        ?.quantity,
    ).toBe(8);
  });
});

describe("a self-correction names the count that stands", () => {
  it("takes the corrected count rather than cancelling both", () => {
    const read = extractStatedQuantities(
      "I need eight bags of finish, actually make it ten bags of finish",
    );

    expect(read).toHaveLength(1);
    expect(read[0]?.quantity).toBe(10);
  });

  it("still cancels two bare counts with no correction between them", () => {
    // "Eight for the walls, four for the ceiling" means twelve, and no rule
    // here can know that. Additive stays the safer reading of two bare numbers.
    expect(
      extractStatedQuantities(
        "eight bags of finish for the walls, four bags of finish for the ceiling",
      ),
    ).toEqual([]);
  });

  it("does not resurrect a cancelled count without an explicit correction", () => {
    expect(
      extractStatedQuantities(
        "eight bags of finish for the walls, four bags of finish for the ceiling. Six bags of finish upstairs.",
      ),
    ).toEqual([]);
  });
});
