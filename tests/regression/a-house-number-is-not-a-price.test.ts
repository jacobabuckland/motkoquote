/**
 * The number on the front of a house is not money.
 *
 * A bare integer becomes a chargeable price unless something stops it, and the
 * only thing that stopped one was a following unit of measure ("110 square
 * metres"). Nothing asked whether the sentence was about money at all, so the
 * site address in voice run 20's opening — the customer's name, then the
 * number and street — reached production as a stated price of £2,020.00.
 *
 * The lookahead requires the street name to be CAPITALISED, and that condition
 * is what keeps the trade's own words safe: half the street-type list are
 * ordinary job words. "Three hundred for the drive" is a price. "40 Green
 * Lane" is an address.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a house number is not a price", () => {
  it("records nothing from a name and an address", () => {
    const prices = extractStatedPrices("It's for Sam Whitfield, 2020 Sample Close.", []);

    expect(prices.map((p) => p.amount)).not.toContain(202000);
    expect(prices, "an address states no price, not even a refused one").toHaveLength(0);
  });

  it("leaves the price alone in a sentence that carries both", () => {
    const prices = extractStatedPrices(
      "The job's at 40 Green Lane, and the skim is four hundred and fifty pounds.",
      [],
    );

    expect(prices.map((p) => p.amount)).toEqual([45000]);
  });

  it("still prices a driveway", () => {
    // "drive" is a street type AND a thing a trade quotes for. The lowercase
    // "the drive" must stay a price.
    const prices = extractStatedPrices("It's three hundred for the drive.", []);

    expect(prices.map((p) => p.amount)).toContain(30000);
  });
});
