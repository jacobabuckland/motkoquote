/**
 * A price written in digits does not run on into the next clause.
 *
 * "one", "a" and the other small number words are money words, so
 *
 *   "one skip at £340, one material delivery at £65"
 *
 * ran "£ 340 one" together as one phrase and parsed it as 340 + 1 = £341 — a
 * price nobody said, while BOTH prices that were said disappeared (£65 was
 * skipped along with the rest of the phrase). Voice run 06 lost its skip and
 * its delivery charge exactly this way.
 *
 * Same failure as the decimal split fixed in #761, arriving through a different
 * door: a clause boundary read as part of the amount.
 */

import { describe, expect, it } from "vitest";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

describe("a digit amount stops at the clause boundary", () => {
  it("reads both prices, and invents neither", () => {
    const prices = extractStatedPrices(
      "The shared costs are one skip at £340, one material delivery at £65, and communal floor protection at £25.",
      [],
    );

    expect(prices.map((p) => p.amount).sort((a, b) => a - b)).toEqual([2500, 6500, 34000]);
    // £341 is what "340" plus the "one" of "one material delivery" came to.
    expect(prices.map((p) => p.amount)).not.toContain(34100);
  });

  it("names each of them", () => {
    const prices = extractStatedPrices(
      "The shared costs are one skip at £340, one material delivery at £65, and communal floor protection at £25.",
      [],
    );

    expect(prices.find((p) => p.amount === 34000)?.item).toContain("skip");
    expect(prices.find((p) => p.amount === 6500)?.item).toContain("delivery");
  });

  it("still reads a spoken amount written entirely in words", () => {
    // The guard only bites once digits are involved; "two hundred and fifty" is
    // one amount and must stay one amount.
    expect(parseSpokenMoneyAmount("two hundred and fifty pounds")).toBe(25000);
    expect(extractStatedPrices("Labour is five hundred and twenty pounds.", [])[0]?.amount).toBe(52000);
  });

  it("still reads a scale word after digits", () => {
    // "£2 thousand" grows the amount rather than crossing a clause, so it is
    // deliberately still allowed.
    expect(parseSpokenMoneyAmount("2 thousand pounds")).toBe(200000);
  });

  it("still reads a currency word after digits", () => {
    expect(parseSpokenMoneyAmount("340 pounds")).toBe(34000);
  });
});
