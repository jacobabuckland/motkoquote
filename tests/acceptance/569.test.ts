import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

// PFIX-13: The spoken-money parser handles "seven and a half thousand"
// (fraction BEFORE scale, fixed in PFIX-11) but not "a grand and a half"
// (fraction AFTER scale). Both orderings are natural British trade speech.
//
// This was not urgent: before PFIX-11 the system returned £1,000 for
// "a grand and a half" (wrong, chargeable), now it returns nothing
// (safe failure — contractor enters manually). This ticket moves from
// safe-failure to correct-extraction.

const amounts = (text: string): number[] =>
  extractStatedPrices(text).map((price) => price.amount);

describe("PFIX-13: fraction after scale word", () => {
  describe("Fraction AFTER scale (new pattern: <number> <scale> and a <fraction>)", () => {
    it("extracts 'a grand and a half'", () => {
      expect(amounts("a grand and a half")).toEqual([150_000]);
    });

    it("extracts 'two grand and a half'", () => {
      expect(amounts("two grand and a half")).toEqual([250_000]);
    });

    it("extracts 'a thousand and a half'", () => {
      expect(amounts("a thousand and a half")).toEqual([150_000]);
    });

    it("extracts 'three thousand and a quarter'", () => {
      expect(amounts("three thousand and a quarter")).toEqual([325_000]);
    });

    it("extracts 'two thousand and three quarters'", () => {
      expect(amounts("two thousand and three quarters")).toEqual([275_000]);
    });

    it("extracts fraction-after-scale in a sentence", () => {
      expect(amounts("I'll do it for a grand and a half, materials included")).toEqual([150_000]);
    });

    it("extracts 'a hundred and a half'", () => {
      expect(amounts("a hundred and a half")).toEqual([15_000]);
    });
  });

  describe("Fraction BEFORE scale (PFIX-11 pattern: <number> and a <fraction> <scale>)", () => {
    // These are the cases PFIX-11 fixed. Kept here so both orderings
    // can never diverge again — they're tested together.

    it("extracts 'seven and a half thousand'", () => {
      expect(amounts("Seven and a half thousand for the whole job")).toEqual([750_000]);
    });

    it("extracts 'two and a half grand'", () => {
      expect(amounts("Two and a half grand, materials included")).toEqual([250_000]);
    });

    it("extracts 'one and a quarter thousand'", () => {
      expect(amounts("One and a quarter thousand pounds is my quote")).toEqual([125_000]);
    });

    it("extracts 'three and three quarters grand'", () => {
      expect(amounts("Three and three quarters grand for labour only")).toEqual([375_000]);
    });

    it("extracts 'one and a half hundred'", () => {
      expect(amounts("One and a half hundred quid")).toEqual([15_000]);
    });
  });

  describe("Edge cases", () => {
    it("does not extract fraction without scale word", () => {
      // "seven and a half" is ambiguous (7.5 what?) — no scale word means no extraction
      expect(amounts("seven and a half for the job")).toEqual([]);
    });

    it("refuses extraction when rate unit is present (fraction after scale)", () => {
      // "a grand and a half a day" is a day rate, not a flat amount
      const prices = extractStatedPrices("a grand and a half a day");
      expect(prices).toHaveLength(1);
      expect(prices[0]?.refused).toBe(true);
    });

    it("refuses extraction when rate unit is present (fraction before scale)", () => {
      // "seven and a half thousand a day" is also a day rate
      const prices = extractStatedPrices("seven and a half thousand a day");
      expect(prices).toHaveLength(1);
      expect(prices[0]?.refused).toBe(true);
    });

    it("does not extract 'half a grand' (different construction, out of scope)", () => {
      // "half a grand" is a third construction (fraction-first with indefinite article)
      // Not handled by this ticket — would need separate logic
      expect(amounts("half a grand for the job")).toEqual([]);
    });
  });
});
