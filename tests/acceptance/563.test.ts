import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";

// Fractional multipliers in spoken amounts were not handled at all.
//
//   "seven and a half thousand"      -> NOTHING
//   "two and a half grand"           -> NOTHING
//   "two and a half thousand pounds" -> NOTHING
//
// Found in a live call, 4 Sep. A contractor said "I'm gonna fix price it at
// seven and a half thousand" and the quote came out correct at £7,500 — but
// the Scope of Work said "No spoken prices were picked up in this call" and
// the £7,500 line carried "Provenance unknown".
//
// The figure survived only because the assistant confirmed it conversationally
// and it reached `pricing.fixed_amount` by a different path. The stated-price
// extractor recorded nothing.
//
// Why that matters beyond a cosmetic label:
// - A price the extractor cannot see cannot be LOCKED (nothing stops a later
//   redraft moving it)
// - It cannot be RECONCILED (PFIX-3's matching depends on stated prices)
// - It cannot be flagged as unattached if it lands on no line
// - The contractor is told their own spoken price was not heard, which is
//   false and reads as the app not listening

const amounts = (text: string): number[] =>
  extractStatedPrices(text).map((price) => price.amount);

describe("PFIX-11: fractional multipliers before scale words", () => {
  describe("and a half", () => {
    it("parses 'seven and a half thousand' as £7,500", () => {
      expect(parseSpokenMoneyAmount("seven and a half thousand")).toBe(750_000);
    });

    it("parses 'two and a half grand' as £2,500", () => {
      expect(parseSpokenMoneyAmount("two and a half grand")).toBe(250_000);
    });

    it("parses 'one and a half thousand pounds' as £1,500", () => {
      expect(parseSpokenMoneyAmount("one and a half thousand pounds")).toBe(150_000);
    });

    it("parses 'three and a half thousand' as £3,500", () => {
      expect(parseSpokenMoneyAmount("three and a half thousand")).toBe(350_000);
    });

    it("parses 'one and a half hundred' as £150", () => {
      expect(parseSpokenMoneyAmount("one and a half hundred")).toBe(15_000);
    });

    it("parses 'five and a half hundred pounds' as £550", () => {
      expect(parseSpokenMoneyAmount("five and a half hundred pounds")).toBe(55_000);
    });
  });

  describe("and a quarter", () => {
    it("parses 'one and a quarter thousand' as £1,250", () => {
      expect(parseSpokenMoneyAmount("one and a quarter thousand")).toBe(125_000);
    });

    it("parses 'two and a quarter grand' as £2,250", () => {
      expect(parseSpokenMoneyAmount("two and a quarter grand")).toBe(225_000);
    });

    it("parses 'five and a quarter thousand pounds' as £5,250", () => {
      expect(parseSpokenMoneyAmount("five and a quarter thousand pounds")).toBe(525_000);
    });

    it("parses 'three and a quarter hundred' as £325", () => {
      expect(parseSpokenMoneyAmount("three and a quarter hundred")).toBe(32_500);
    });
  });

  describe("and three quarters", () => {
    it("parses 'one and three quarters thousand' as £1,750", () => {
      expect(parseSpokenMoneyAmount("one and three quarters thousand")).toBe(175_000);
    });

    it("parses 'three and three quarters grand' as £3,750", () => {
      expect(parseSpokenMoneyAmount("three and three quarters grand")).toBe(375_000);
    });

    it("parses 'two and three quarters thousand pounds' as £2,750", () => {
      expect(parseSpokenMoneyAmount("two and three quarters thousand pounds")).toBe(275_000);
    });

    it("parses 'four and three quarters hundred' as £475", () => {
      expect(parseSpokenMoneyAmount("four and three quarters hundred")).toBe(47_500);
    });
  });

  describe("edge cases", () => {
    it("returns null for fractional without scale word ('seven and a half')", () => {
      expect(parseSpokenMoneyAmount("seven and a half")).toBeNull();
    });

    it("returns null for malformed fraction ('seven a half thousand')", () => {
      expect(parseSpokenMoneyAmount("seven a half thousand")).toBeNull();
    });

    it("returns null for malformed fraction ('one and half thousand')", () => {
      expect(parseSpokenMoneyAmount("one and half thousand")).toBeNull();
    });

    it("still parses whole amounts correctly ('seven thousand')", () => {
      expect(parseSpokenMoneyAmount("seven thousand")).toBe(700_000);
    });

    it("still parses whole hundreds correctly ('five hundred')", () => {
      expect(parseSpokenMoneyAmount("five hundred")).toBe(50_000);
    });
  });

  describe("extraction from full sentences", () => {
    it("extracts from 'The job is seven and a half thousand pounds'", () => {
      expect(amounts("The job is seven and a half thousand pounds")).toEqual([750_000]);
    });

    it("extracts from 'I'm gonna fix price it at seven and a half thousand'", () => {
      expect(amounts("I'm gonna fix price it at seven and a half thousand")).toEqual([750_000]);
    });

    it("extracts from 'Materials are two and a quarter grand'", () => {
      expect(amounts("Materials are two and a quarter grand")).toEqual([225_000]);
    });

    it("extracts the item alongside the fractional amount", () => {
      const prices = extractStatedPrices("Labour is three and a half thousand pounds");
      expect(prices.map((p) => p.amount)).toEqual([350_000]);
      expect(prices[0]?.item).toBe("Labour");
    });
  });

  describe("behaviour that must not change", () => {
    it("still refuses amounts with hedges ('around seven and a half thousand')", () => {
      const prices = extractStatedPrices("around seven and a half thousand");
      expect(prices.length).toBe(1);
      expect(prices[0]?.amount).toBe(750_000);
      expect(prices[0]?.refused).toBe(true);
    });

    it("still refuses amounts with ranges ('between seven and eight thousand')", () => {
      const prices = extractStatedPrices("between seven and eight thousand");
      // Should extract both amounts but mark as refused
      expect(prices.every((p) => p.refused)).toBe(true);
    });

    it("does not invent fractions where there are none", () => {
      expect(amounts("We will re-skim the walls and make good.")).toEqual([]);
    });

    it("still extracts non-fractional amounts correctly", () => {
      expect(amounts("The consumer unit is five hundred and twenty pounds")).toEqual([52_000]);
    });
  });
});
