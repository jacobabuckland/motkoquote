/**
 * A price the contractor writes — "£10.80 a bag" — must reach the quote as
 * £10.80.
 *
 * Voice run 01 (15 Sep 2026) quoted "1 bag @ £148.00" for finishing plaster
 * the contractor had priced at £10.80. Three things had to line up for that,
 * and all three are pinned here:
 *
 *   1. The sentence splitter treated the point in "£10.80" as a full stop, so
 *      one sentence about three materials became three fragments, each real
 *      price stranded at the end of one and each orphaned PENCE figure sitting
 *      at the start of the next directly before the word "each".
 *   2. The tokeniser stripped the point again, so "£10.80" read as "£10" "80".
 *   3. `parseSpokenMoneyAmount` deleted the pound sign before looking for a
 *      pound marker, so any written amount under £100 was refused outright by
 *      the `value >= 100` fallback.
 *
 * Each one is independently sufficient to lose the price, so each is asserted
 * on its own as well as end to end.
 */

import { describe, expect, it } from "vitest";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a written price survives extraction", () => {
  it("parses a written amount with pence", () => {
    expect(parseSpokenMoneyAmount("£10.80")).toBe(1080);
    expect(parseSpokenMoneyAmount("£14.50")).toBe(1450);
    expect(parseSpokenMoneyAmount("14.50 pounds")).toBe(1450);
    // One decimal place is tenths of a pound, not pence.
    expect(parseSpokenMoneyAmount("£10.5")).toBe(1050);
  });

  it("parses a written amount under £100, which has no pound word to lean on", () => {
    expect(parseSpokenMoneyAmount("£26")).toBe(2600);
    expect(parseSpokenMoneyAmount("£95")).toBe(9500);
    expect(parseSpokenMoneyAmount("26 quid")).toBe(2600);
  });

  it("still refuses a bare number with no currency marker", () => {
    // Left to the general path deliberately: a quantity must not become money
    // just because it is written as digits.
    expect(parseSpokenMoneyAmount("26")).toBeNull();
  });

  it("reads every price in one spoken sentence about several materials", () => {
    const prices = extractStatedPrices(
      "I'll be getting 26 bags of finishing plaster at £10.80 each, " +
        "8 bags of backing plaster at £14.50 each, 4 tubs of primer at £26 each.",
      [],
    );

    expect(prices.map((p) => p.amount).sort((a, b) => a - b)).toEqual([1080, 1450, 2600]);
    // Each one is per-unit, so a 26-bag line multiplies rather than flattening
    // to a single bag at the stated figure.
    expect(prices.every((p) => p.qualifiers.each)).toBe(true);
    expect(prices.every((p) => p.refused)).toBe(false);
  });

  it("invents nothing from the pence half of a decimal", () => {
    const prices = extractStatedPrices(
      "I'll be getting 26 bags of finishing plaster at £10.80 each, " +
        "8 bags of backing plaster at £14.50 each, 4 tubs of primer at £26 each.",
      [],
    );

    // £80.00 and £50.00 are what the pence became when the sentence was cut at
    // the decimal point. Neither figure was said by anyone.
    expect(prices.map((p) => p.amount)).not.toContain(8000);
    expect(prices.map((p) => p.amount)).not.toContain(5000);
  });

  it("does not abandon a sentence that opens with a quantity", () => {
    // The scan used to try the first money word once and give up, so a price
    // introduced by "26 bags of" was never reached at all.
    const prices = extractStatedPrices("4 tubs of primer at £26 each.", []);

    expect(prices.map((p) => p.amount)).toEqual([2600]);
  });

  it("keeps a whole-pound price at the end of a sentence", () => {
    const prices = extractStatedPrices("Waste removal is £140. That covers the skip.", []);

    expect(prices.map((p) => p.amount)).toEqual([14000]);
  });
});
