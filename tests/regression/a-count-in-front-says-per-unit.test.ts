/**
 * "18 bags of finish at £11.50" is a price per bag, with nothing after it
 * saying so.
 *
 * Per-unit detection reads the words AFTER an amount — "each", "per bag",
 * "/bag", "a bag". A trade listing materials marks the second item and not the
 * first, because the count in front has already said it:
 *
 *     "Materials are 18 bags of finish at £11.50, two tubs of primer at £27
 *      each, and £88 for protection."
 *
 * The £27 was per-unit and the £11.50 was not, so 17 bags of plaster left a
 * live quote: £11.50 charged against £207 stated (job 26ce40ac, 16 Sep).
 *
 * The count was never the missing part — `statedCountBefore` has always found
 * it. What was missing is permission to read it as a per-unit signal, and that
 * permission has to be narrow, because scanning backwards for a count runs into
 * the previous clause. Three conditions, and this file is mostly the cases that
 * forced each one:
 *
 *   1. A COUNTABLE unit, never a measure — "148 square metres of walls at £600"
 *      is the price of the area. Unbounded, that is a £12,000 line.
 *   2. Joined by "at" — "for £600" reads as a total.
 *   3. The same clause — the text before "£88 for protection" ends "…two tubs
 *      of primer at £27 each, and", and an unguarded read bills £176.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices, perUnitCountBefore } from "@/lib/voice/stated-prices";

const priceIn = (sentence: string, amount: number) =>
  extractStatedPrices(sentence, []).find((p) => p.amount === amount);

const CAFE =
  "Materials are 18 bags of finish at £11.50, two tubs of primer at £27 each, and £88 for protection.";

describe("the cafe materials sentence, as production captured it", () => {
  it("reads the unmarked first item as per-unit, with its count", () => {
    const finish = priceIn(CAFE, 1150);

    expect(finish?.qualifiers.each).toBe(true);
    expect(finish?.quantity, "17 bags went missing from a live quote").toBe(18);
  });

  it("leaves the marked middle item exactly as it was", () => {
    const primer = priceIn(CAFE, 2700);

    expect(primer?.qualifiers.each).toBe(true);
    expect(primer?.quantity).toBe(2);
  });

  it("does not reach back across the comma for the lump sum", () => {
    // The whole reason the rule is clause-bounded. "two tubs" is the nearest
    // count in front of this amount and belongs to a different item; billing
    // 2 × £88 for surface protection is the failure this prevents.
    const protection = priceIn(CAFE, 8800);

    expect(protection?.qualifiers.each).toBe(false);
    expect(protection && "quantity" in protection).toBe(false);
  });
});

describe("a measure is not a count", () => {
  it.each(["at", "for"])(
    "leaves an area priced %s a figure as the price of the area",
    (join) => {
      const sentence = `We're skimming 148 square metres of walls ${join} £600.`;
      const price = priceIn(sentence, 60000);

      expect(price?.qualifiers.each, "£600 per square metre is £88,800").toBe(false);
    },
  );
});

describe("the phrasings that must keep working", () => {
  it.each([
    ["Eight bags of bonding at eleven pounds a bag.", 1100, 8],
    ["We'll need 7 bags of bonding at £14.50.", 1450, 7],
    ["I'll take 26 bags of finishing plaster at £10.80 each.", 1080, 26],
  ])("%s", (sentence, amount, count) => {
    const price = priceIn(sentence, amount);

    expect(price?.qualifiers.each).toBe(true);
    expect(price?.quantity).toBe(count);
  });

  it.each([
    ["I normally charge one hundred and forty pounds for a radiator swap.", 14000],
    ["I'll do the whole job for two thousand pounds all in.", 200000],
    ["The equipment's £45 a shift, but they capped it at £120 for the job.", 12000],
  ])("%s stays a lump sum", (sentence, amount) => {
    expect(priceIn(sentence, amount)?.qualifiers.each).toBe(false);
  });
});

describe("the rule on its own", () => {
  // Read directly, so a failure names the condition rather than a whole quote.
  it.each([
    ["18 bags of finish at ", 18, "count, countable unit, of-phrase, at"],
    ["7 bags of bonding at ", 7, "digits"],
    ["Eight bags of bonding at ", 8, "a spoken count"],
    ["two tubs at ", 2, "no of-phrase"],
  ])("accepts %j", (before, expected) => {
    expect(perUnitCountBefore(before)).toBe(expected);
  });

  it.each([
    ["…at £27 each, and ", "a clause boundary"],
    ["18 bags of finish for ", "joined by 'for'"],
    ["148 square metres of walls at ", "a measure unit"],
    ["the bags at ", "no count"],
    ["18 bags of some rather long intervening description here at ", "too far from the unit"],
  ])("refuses %j", (before) => {
    expect(perUnitCountBefore(before)).toBeNull();
  });
});
