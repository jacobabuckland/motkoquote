import { describe, expect, it } from "vitest";
import { extractStatedPrices } from "@/lib/voice/stated-prices";

// The stated-price extractor failed to recognize fractional multipliers
// (e.g., "and a half", "and a quarter") in spoken money amounts.
//
// Found in a live call on 4 Sep 2026: a contractor said "I'm gonna fix price
// it at seven and a half thousand" but the extractor returned nothing.
//
// This regression test covers the "leading form" — where the fractional amount
// appears at the very start of the text, without a preceding item or context.

const amounts = (text: string): number[] =>
  extractStatedPrices(text).map((price) => price.amount);

describe("Regression: fractional amounts in leading position", () => {
  it("extracts 'Seven and a half thousand for the whole job'", () => {
    expect(amounts("Seven and a half thousand for the whole job")).toEqual([750_000]);
  });

  it("extracts 'Two and a half grand, materials included'", () => {
    expect(amounts("Two and a half grand, materials included")).toEqual([250_000]);
  });

  it("extracts 'One and a quarter thousand pounds is my quote'", () => {
    expect(amounts("One and a quarter thousand pounds is my quote")).toEqual([125_000]);
  });

  it("extracts 'Three and three quarters grand for labour only'", () => {
    expect(amounts("Three and three quarters grand for labour only")).toEqual([375_000]);
  });

  it("extracts bare leading fractional amount", () => {
    expect(amounts("Seven and a half thousand")).toEqual([750_000]);
  });

  it("extracts 'One and a half hundred quid'", () => {
    expect(amounts("One and a half hundred quid")).toEqual([15_000]);
  });

  it("handles leading fractional with item attribution", () => {
    const prices = extractStatedPrices("Seven and a half thousand for materials");
    expect(prices.map((p) => p.amount)).toEqual([750_000]);
    expect(prices[0]?.item).toBe("materials");
  });

  it("does not extract leading malformed fractions", () => {
    expect(amounts("Seven a half thousand for the job")).toEqual([]);
  });

  it("does not extract leading fractions without scale word", () => {
    expect(amounts("Seven and a half for the job")).toEqual([]);
  });
});
