/**
 * A bare number followed by a unit is a measurement, and must not be recorded
 * as money — not even as a refusal.
 *
 * Voice run 01 quoted a phantom £148 and run 05 a phantom £110, both read
 * straight out of "148 square metres of walls" and "110 square metres of
 * walls". The extractor admits any bare integer as a money candidate, and the
 * only thing standing between a bare integer and a locked price was
 * `containsRateUnit`, whose area pattern is the singular, article-led "a
 * square metre" — a form nobody uses when stating an area.
 *
 * A refusal would not have been enough here. A refused price is still a price
 * the contractor is recorded as having stated; it reaches the run view and the
 * unattached-price flag. 148 square metres is not a price at all.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a quantity is not a price", () => {
  it("records nothing from an area", () => {
    expect(
      extractStatedPrices(
        "We're skimming 148 square metres of walls and 52 square metres of ceilings.",
        [],
      ),
    ).toEqual([]);
  });

  it("records nothing from the other units a trade states", () => {
    for (const sentence of [
      "Prepare and skim 110 square metres of walls and 38 square metres of ceilings.",
      "It's 32 linear metres of skirting.",
      "I'll need 26 bags and 4 tubs.",
      "That's 18 sheets of plasterboard and 2 rolls of scrim.",
      "Two coats throughout.",
    ]) {
      expect(extractStatedPrices(sentence, []), sentence).toEqual([]);
    }
  });

  it("leaves a priced measurement alone", () => {
    // The guard fires on the ABSENCE of a currency marker, so an amount that
    // states its own currency is never reinterpreted.
    const prices = extractStatedPrices("The skim is £450 for the whole room.", []);

    expect(prices.map((p) => p.amount)).toEqual([45000]);
  });

  it("still records a day rate as a refusal rather than dropping it", () => {
    // Time units are outside the guard on purpose: "a day" is a rate, not a
    // quantity, and refusing it is the right outcome — silently losing it is
    // not, because the contractor said a number and is owed an explanation of
    // what became of it.
    const prices = extractStatedPrices("Labour is two hundred and fifty a day.", []);

    expect(prices).toHaveLength(1);
    expect(prices[0]?.refused).toBe(true);
  });
});
