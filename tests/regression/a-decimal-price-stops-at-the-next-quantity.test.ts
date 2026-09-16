/**
 * A price in pounds and pence does not absorb the next item's quantity.
 *
 * #763 stopped a digit amount running into a number WORD ("£340 one material
 * delivery" → £341). The same clause boundary arrives in digits when the next
 * item leads with its quantity, and `moneyWords` admits any bare integer:
 *
 *   "18 bags of finish at £11.50, 2 tubs of primer at £27 each"  → £1,152.00
 *   "28 bags of finish at £11.20, 7 bonding at £14.50"           → £1,127.00
 *
 * Both reached production, from voice runs 19 and 20. The phantom is worse
 * than a lost price: it is chargeable, it carries no flag, and the pence of a
 * real price are what pay for its hundreds — £11.50 and a 2 make £1,152.
 */

import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a decimal price stops at the next quantity", () => {
  it("invents no £1,152 from £11.50 and a 2", () => {
    const prices = extractStatedPrices(
      "Materials are 18 bags of finish at £11.50, 2 tubs of primer at £27 each, and £88 for protection.",
      [],
    );

    expect(prices.map((p) => p.amount)).not.toContain(115200);
  });

  it("invents no £1,127 from £11.20 and a 7", () => {
    const prices = extractStatedPrices(
      "We supply 28 bags of finish at £11.20, 7 bonding at £14.50, and £105 for beads, tape and fixings.",
      [],
    );

    expect(prices.map((p) => p.amount)).not.toContain(112700);
  });

  it("reads the prices that were actually stated", () => {
    const prices = extractStatedPrices(
      "Materials are 18 bags of finish at £11.50, 2 tubs of primer at £27 each, and £88 for protection.",
      [],
    );

    const amounts = prices.map((p) => p.amount);
    expect(amounts).toContain(1150);
    expect(amounts).toContain(2700);
    expect(amounts).toContain(8800);
  });

  it("still lets a digit amount take a scale word", () => {
    // "£2 thousand" is one amount, not a 2 followed by something else.
    const prices = extractStatedPrices("The whole job is £2 thousand.", []);

    expect(prices.map((p) => p.amount)).toContain(200000);
  });
});
