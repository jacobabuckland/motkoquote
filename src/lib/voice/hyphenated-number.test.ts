import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

// A hyphenated compound number lost its tens component entirely.
//
//   "twenty-two thousand pounds"  ->  £1,000.00     22x under
//   "twenty two thousand pounds"  ->  £22,000.00    correct
//
// That difference is what isolated it: `parseSpokenMoneyAmount` has stripped
// hyphens since it was written, so parsing was never the problem. The scan in
// `extractBestMoneyPhrase` cleaned `.,!?;:` and not `-`, so "twenty-two"
// stayed one token, matched no entry in `moneyWords`, and the phrase began at
// the next word that did — "thousand".
//
// Two things made it worth pulling ahead of the rest of the price chain.
// Transcripts are machine produced and transcribers hyphenate compound
// numbers as a matter of course, so the broken form is plausibly the common
// one rather than the edge case. And the wrong figure was CHARGEABLE, not
// refused — it became the contractor's own stated price, authoritative to
// everything downstream.

const amounts = (text: string): number[] =>
  extractStatedPrices(text).map((price) => price.amount);

describe("a hyphenated compound number keeps its tens", () => {
  it("reads twenty-two thousand as £22,000, not £1,000", () => {
    expect(amounts("twenty-two thousand pounds")).toEqual([2_200_000]);
  });

  it("agrees with the spaced form, which was always correct", () => {
    expect(amounts("twenty-two thousand pounds")).toEqual(
      amounts("twenty two thousand pounds"),
    );
  });

  it("holds for other compounds, not just twenty-two", () => {
    expect(amounts("thirty-five thousand pounds")).toEqual([3_500_000]);
    expect(amounts("forty-seven pounds")).toEqual([4_700]);
  });

  it("reads it inside an ordinary sentence", () => {
    expect(amounts("The job is twenty-two thousand pounds.")).toEqual([2_200_000]);
  });
});

describe("behaviour that must not change", () => {
  it("still reads an unhyphenated amount and its item", () => {
    const prices = extractStatedPrices(
      "The consumer unit is five hundred and twenty pounds.",
    );
    expect(prices.map((p) => p.amount)).toEqual([52_000]);
    // The item is taken from the words before the amount, and hyphen splitting
    // shifts word indices — so this asserts the split did not disturb it.
    expect(prices[0]?.item).toBe("consumer unit");
  });

  it("does not invent a price where there is no amount", () => {
    expect(amounts("We will re-skim the walls and make good.")).toEqual([]);
  });
});
