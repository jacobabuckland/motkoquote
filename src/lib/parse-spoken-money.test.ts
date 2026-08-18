import { describe, it, expect } from "vitest";
import { parseSpokenMoneyAmount } from "./parse-spoken-money";

describe("parseSpokenMoneyAmount", () => {
  describe("whole pounds", () => {
    it("parses 'two eighty' as £280.00", () => {
      expect(parseSpokenMoneyAmount("two eighty")).toBe(28000);
    });

    it("parses 'two hundred and eighty' as £280.00", () => {
      expect(parseSpokenMoneyAmount("two hundred and eighty")).toBe(28000);
    });

    it("parses '280 pounds' as £280.00", () => {
      expect(parseSpokenMoneyAmount("280 pounds")).toBe(28000);
    });

    it("parses 'two eighty pounds' as £280.00", () => {
      expect(parseSpokenMoneyAmount("two eighty pounds")).toBe(28000);
    });

    it("parses 'two hundred and eighty pounds' as £280.00", () => {
      expect(parseSpokenMoneyAmount("two hundred and eighty pounds")).toBe(28000);
    });

    it("parses 'two hundred and eighty quid' as £280.00", () => {
      expect(parseSpokenMoneyAmount("two hundred and eighty quid")).toBe(28000);
    });

    it("parses 'three hundred' as £300.00", () => {
      expect(parseSpokenMoneyAmount("three hundred")).toBe(30000);
    });

    it("parses 'hundred and twenty' as £120.00", () => {
      expect(parseSpokenMoneyAmount("hundred and twenty")).toBe(12000);
    });

    it("parses 'two thousand' as £2,000.00", () => {
      expect(parseSpokenMoneyAmount("two thousand")).toBe(200000);
    });

    it("parses 'twenty three thousand' as £23,000.00", () => {
      expect(parseSpokenMoneyAmount("twenty three thousand")).toBe(2300000);
    });

    it("parses 'five hundred quid' as £500.00", () => {
      expect(parseSpokenMoneyAmount("five hundred quid")).toBe(50000);
    });
  });

  describe("pounds and pence", () => {
    it("parses 'two pounds eighty' as £2.80", () => {
      expect(parseSpokenMoneyAmount("two pounds eighty")).toBe(280);
    });

    it("parses 'two pound eighty' as £2.80", () => {
      expect(parseSpokenMoneyAmount("two pound eighty")).toBe(280);
    });

    it("parses 'five pounds fifty' as £5.50", () => {
      expect(parseSpokenMoneyAmount("five pounds fifty")).toBe(550);
    });
  });

  describe("pence only", () => {
    it("parses 'thirty five pence' as 35 pence", () => {
      expect(parseSpokenMoneyAmount("thirty five pence")).toBe(35);
    });

    it("parses 'fifty pence' as 50 pence", () => {
      expect(parseSpokenMoneyAmount("fifty pence")).toBe(50);
    });

    it("parses 'ninety nine pence' as 99 pence", () => {
      expect(parseSpokenMoneyAmount("ninety nine pence")).toBe(99);
    });
  });

  describe("four-part amounts (£XX.XX)", () => {
    it("parses 'two eighty five ninety-nine' as £285.99", () => {
      expect(parseSpokenMoneyAmount("two eighty five ninety-nine")).toBe(28599);
    });

    it("parses 'two eighty five ninety nine' as £285.99", () => {
      expect(parseSpokenMoneyAmount("two eighty five ninety nine")).toBe(28599);
    });

    it("parses 'eighty five ninety nine' as £85.99", () => {
      expect(parseSpokenMoneyAmount("eighty five ninety nine")).toBe(8599);
    });

    it("parses 'forty two thirty five' as £42.35", () => {
      expect(parseSpokenMoneyAmount("forty two thirty five")).toBe(4235);
    });
  });

  describe("ambiguous cases", () => {
    it("returns null for 'two eighty five' (ambiguous: £280.05 or £2.85)", () => {
      expect(parseSpokenMoneyAmount("two eighty five")).toBeNull();
    });

    it("returns null for 'three forty two' (ambiguous: £340.02 or £3.42)", () => {
      expect(parseSpokenMoneyAmount("three forty two")).toBeNull();
    });
  });

  describe("unparseable inputs", () => {
    it("returns null for text with no amount", () => {
      expect(parseSpokenMoneyAmount("I bought some stuff")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseSpokenMoneyAmount("")).toBeNull();
    });

    it("returns null for just words with no numbers", () => {
      expect(parseSpokenMoneyAmount("um yeah so materials and stuff")).toBeNull();
    });

    it("returns null for partial/incomplete amounts", () => {
      expect(parseSpokenMoneyAmount("about")).toBeNull();
    });
  });

  describe("edge cases and variations", () => {
    it("handles 'twenty' as £20.00", () => {
      expect(parseSpokenMoneyAmount("twenty")).toBeNull(); // < 100, not explicitly marked
    });

    it("handles 'twenty pounds' as £20.00", () => {
      expect(parseSpokenMoneyAmount("twenty pounds")).toBe(2000);
    });

    it("handles 'hundred' as £100.00", () => {
      expect(parseSpokenMoneyAmount("hundred")).toBe(10000);
    });

    it("handles 'thousand pounds' as £1,000.00", () => {
      expect(parseSpokenMoneyAmount("thousand pounds")).toBe(100000);
    });

    it("handles 'one pound' as £1.00", () => {
      expect(parseSpokenMoneyAmount("one pound")).toBe(100);
    });
  });

  describe("determinism", () => {
    it("returns the same result for the same input", () => {
      const input = "two hundred and eighty pounds";
      const result1 = parseSpokenMoneyAmount(input);
      const result2 = parseSpokenMoneyAmount(input);
      expect(result1).toBe(result2);
      expect(result1).toBe(28000);
    });

    it("is a pure function (no side effects)", () => {
      const input = "fifty quid";
      // Call it multiple times
      for (let i = 0; i < 10; i++) {
        expect(parseSpokenMoneyAmount(input)).toBe(5000);
      }
    });
  });
});
