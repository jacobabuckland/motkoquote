/**
 * Scenario 41 lost GBP 121 because nobody stops talking at the figure.
 *
 * A bare number after "at" is money -- "one primer tub at 25" can be nothing
 * else -- and #843 made that readable. It guarded the rule by requiring the
 * CLAUSE TO END after the figure: the sentence, an "and", or a comma. That is
 * a fair proxy for "nothing modifies this number", which is the real question,
 * and it is far stricter than the thing it stands for.
 *
 * Spoken aloud, the scenario's contractor said:
 *
 *   "One primer tub at 25 as well."        dropped on "as"
 *   "8 at 12 is the final figure."         dropped on "is"
 *
 * Neither figure was extracted. Only "They are 12 pounds each, not 11" was --
 * the one sentence carrying a currency word -- and it names no item, so it
 * reached no line either. The quote went out at GBP 250 against GBP 371.
 *
 * WHY THIS SURVIVED THREE REPLAYS AND FOUR FIXES. Every other scenario in the
 * tranche said "£12 a bag" or "96 pounds total", and a phrase with a currency
 * marker never goes near this rule. 41 is the only one whose contractor said
 * the amounts bare, so the defect was invisible in the aggregate and looked
 * like an ownership problem in the particular. The regression test written for
 * 41 the day before used "£12" and "£25" -- a transcript no live call
 * produces -- and passed against a tree that could not price the real one.
 *
 * So the fixture here is the transcription verbatim, and the file is as much
 * about what must STILL be refused: a time, a house number and a measurement
 * are all a bare number after "at" with words behind it, and charging one of
 * them invents money nobody said.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const amounts = (sentence: string) => extractStatedPrices(sentence).map((p) => p.amount);

describe("the two figures scenario 41 said out loud", () => {
  it("reads the primer at 25 through 'as well'", () => {
    const [price] = extractStatedPrices("One primer tub at 25 as well.");

    expect(price?.amount).toBe(2500);
    expect(price?.item?.toLowerCase()).toBe("primer tub");
  });

  it("reads the confirming '8 at 12' through 'is the final figure'", () => {
    const [price] = extractStatedPrices("8 at 12 is the final figure.");

    expect(price?.amount).toBe(1200);
    expect(price?.quantity).toBe(8);
    expect(price?.qualifiers.each).toBe(true);
  });

  it("reads both out of the whole utterance, with the rate said twice", () => {
    const said =
      "I need 10 bags of finish. Sorry, make that 8 bags. They are 12 pounds each, not 11. " +
      "8 at 12 is the final figure. One primer tub at 25 as well. " +
      "These are customer prices before VAT with no markup.";

    // GBP 12 twice -- which is how a trade confirms a number -- and GBP 25.
    expect(amounts(said).sort((a, b) => a - b)).toEqual([1200, 1200, 2500]);
  });
});

describe("the tails a trade actually puts after a figure", () => {
  it.each([
    ["One primer tub at 25 as well.", 2500],
    ["One primer tub at 25 too.", 2500],
    ["One primer tub at 25 please.", 2500],
    ["The finish is at 12 before VAT.", 1200],
    ["The finish is at 12 plus VAT.", 1200],
    ["The primer is at 25 or so.", 2500],
    ["The primer is at 25 max.", 2500],
    ["The skip is at 90 all in.", 9000],
  ])("reads %s", (sentence, expected) => {
    expect(amounts(sentence)).toEqual([expected]);
  });

  it("still reads one that genuinely ends the clause", () => {
    // The original rule, unchanged -- this is what must not regress.
    expect(amounts("Primer tub at 25.")).toEqual([2500]);
    expect(amounts("Finish at 12 and primer at 25.")).toEqual([1200, 2500]);
  });
});

describe("what a bare number after 'at' must never become", () => {
  it.each([
    // A clock, by the verb in front of it.
    "I'll start at 8 as well.",
    "I'll be there at 8 too.",
    "I'll come at 6 as well.",
    "I'll get there at 7 please.",
    // A clock, by what follows it.
    "I'll do it at 8 in the morning.",
    "I'll do it at 8 on Monday.",
    // A house number.
    "The job is at 27 Green Lane.",
    // A measurement.
    "We're going at 30 square metres a day.",
    "It comes at 4 bags each.",
  ])("refuses %s", (sentence) => {
    expect(amounts(sentence)).toEqual([]);
  });

  it("refuses the figure but not the sentence beside it", () => {
    // The guard is per-number: a real price in the same breath still lands.
    expect(amounts("I'll start at 8 as well, and the primer is 25 pounds.")).toEqual([2500]);
  });
});
