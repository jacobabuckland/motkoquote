/**
 * Two prices for two different things stay two prices.
 *
 * Items were matched by containment — a bare `includes` — so a one-letter item
 * name matched almost anything: `"waste".includes("s")` is true. And a
 * one-letter name was easy to produce, because `\w` does not span an
 * apostrophe and the last-resort item pattern takes the trailing word
 * characters before the amount. "The equipment's £45 a shift" named its item
 * "s".
 *
 * Grouping by item is how supersession is decided, so on voice run 19 the £45
 * hire, the £12 parking and the £165 waste collapsed into a single item and
 * overwrote one another. Three distinct charges reached the quote as £12, and
 * the two that were destroyed had been captured correctly. The report that
 * found it could only describe the symptom: "several distinct prices become
 * £12".
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

const RUN_19 =
  "The equipment's £45 a shift, but they capped it at £120 for the job. " +
  "Parking's £12 a shift for one van. Waste is £165.";

describe("one item does not swallow another", () => {
  it("keeps each charge at its own amount", () => {
    const prices = extractStatedPrices(RUN_19, []);

    for (const amount of [4500, 1200, 16500]) {
      const price = prices.find((p) => p.amount === amount);
      expect(price, `£${amount / 100} was stated`).toBeDefined();
      expect(
        price?.superseded_by,
        `£${amount / 100} was never corrected by anything`,
      ).toBeNull();
    }
  });

  it("names them apart, rather than naming one of them 's'", () => {
    const prices = extractStatedPrices(RUN_19, []);

    expect(prices.find((p) => p.amount === 4500)?.item).toContain("equipment");
    expect(prices.find((p) => p.amount === 1200)?.item?.toLowerCase()).toContain("parking");
  });

  it("still treats a longer name containing a shorter one as the same item", () => {
    // Containment is what lets "consumer unit" and "consumer unit labour" be
    // one item. Requiring whole words must not cost that.
    const prices = extractStatedPrices(
      "Consumer unit labour will be four eighty... no, make it five twenty for the consumer unit.",
      [],
    );

    expect(prices.find((p) => p.amount === 48000)?.superseded_by).toBe(52000);
  });
});
