/**
 * PFIX-12: transcript_span is not the transcript — the normalised form leaks
 *
 * Tests that transcript_span stores verbatim substrings from the original
 * transcript, not the normalised form used for parsing.
 */

import { describe, expect, it } from "vitest";
import type { StatedPrice } from "@/lib/schemas/stated-price";

describe("PFIX-12: transcript_span stores verbatim text, not normalised form", () => {
  it("every transcript_span is a verbatim substring of the input transcript", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "I'll charge you three grand for the rewire, and two and a half grand for the lot including materials.";

    const prices = mod.extractStatedPrices(transcript);

    // At least some prices should be extracted
    expect(prices.length).toBeGreaterThan(0);

    // Every transcript_span must be a verbatim substring of the original
    for (const price of prices) {
      expect(
        transcript.includes(price.transcript_span),
        `transcript_span "${price.transcript_span}" is not a substring of the original transcript`
      ).toBe(true);
    }
  });

  it("preserves 'one and a half grand' verbatim, not 'one and a half thousand pounds'", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "I'll charge you one and a half grand for the rewire.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBeGreaterThan(0);
    const price = prices[0] as StatedPrice;

    // The span must contain the verbatim phrase, not the normalised form
    expect(price.transcript_span.toLowerCase()).toContain("one and a half grand");
    expect(price.transcript_span).not.toContain("thousand pounds");
  });

  it("preserves 'two and a half grand for the lot' verbatim", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "Two and a half grand for the lot, including materials.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBeGreaterThan(0);
    const price = prices[0] as StatedPrice;

    // The span must contain the verbatim phrase
    expect(price.transcript_span.toLowerCase()).toContain("two and a half grand");
    expect(price.transcript_span).not.toContain("thousand pounds");
  });

  it("preserves 'three grand' verbatim, not 'three thousand pounds'", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "The rewire is three grand.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBe(1);
    const price = prices[0] as StatedPrice;

    expect(price.transcript_span.toLowerCase()).toContain("three grand");
    expect(price.transcript_span).not.toContain("three thousand pounds");
  });

  it("preserves 'a hundred' verbatim (not normalised to 'one hundred')", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "Materials will be a hundred and fifty pounds.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBe(1);
    const price = prices[0] as StatedPrice;

    // The span should contain "a hundred", not "one hundred"
    expect(price.transcript_span.toLowerCase()).toContain("a hundred");
    // Verify it has NOT been normalised
    const hasOneHundred = price.transcript_span.match(/\bone hundred/i);
    expect(hasOneHundred).toBeNull();
  });

  it("preserves 'a thousand' verbatim (not normalised to 'one thousand')", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "The quote is a thousand pounds for labour.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBe(1);
    const price = prices[0] as StatedPrice;

    // The span should contain "a thousand", not "one thousand"
    expect(price.transcript_span.toLowerCase()).toContain("a thousand");
    // Verify it has NOT been normalised
    const hasOneThousand = price.transcript_span.match(/\bone thousand/i);
    expect(hasOneThousand).toBeNull();
  });

  it("extracted amounts are unchanged by this fix", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    // Test cases with known amounts that must not change
    const cases: Array<{ transcript: string; expectedAmount: number }> = [
      { transcript: "I'll charge you one and a half grand.", expectedAmount: 150000 }, // £1,500
      { transcript: "Two and a half grand for the lot.", expectedAmount: 250000 }, // £2,500
      { transcript: "Three grand for the rewire.", expectedAmount: 300000 }, // £3,000
      { transcript: "One hundred and fifty pounds.", expectedAmount: 15000 }, // £150
      { transcript: "One thousand pounds for labour.", expectedAmount: 100000 }, // £1,000
    ];

    for (const testCase of cases) {
      const prices = mod.extractStatedPrices(testCase.transcript);
      expect(prices.length, `Expected one price from: ${testCase.transcript}`).toBe(1);
      const price = prices[0] as StatedPrice;
      expect(
        price.amount,
        `Amount mismatch for: ${testCase.transcript}`
      ).toBe(testCase.expectedAmount);
    }
  });

  it("already-verbatim spans stay byte-identical", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    // Sentence that needs no normalisation
    const transcript = "Labour will be six hundred pounds.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices.length).toBe(1);
    const price = prices[0] as StatedPrice;

    // The span should be the sentence without the terminal punctuation
    // (sentence splitting removes periods)
    expect(price.transcript_span).toBe("Labour will be six hundred pounds");
  });

  it("contact-detail redaction stays in the span (not restored)", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    // Contains a phone number that will be redacted
    const transcript = "Ring me on 07700 900123, and the skim is four hundred and fifty pounds.";

    const prices = mod.extractStatedPrices(transcript);

    // Should extract the £450, not the phone number
    expect(prices.length).toBeGreaterThan(0);

    for (const price of prices) {
      // The span must not contain the original phone number
      expect(price.transcript_span).not.toContain("07700 900123");
      // It should contain the redacted marker if the sentence was redacted
      // (or just not contain the phone number at all)
      if (price.amount === 45000) {
        // The £450 span
        expect(price.transcript_span.toLowerCase()).toContain("four hundred and fifty");
      }
    }
  });

  it("handles multiple extractions from the same sentence with verbatim spans", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    // Sentence with self-resolved range (PFIX-1 allows this)
    const transcript = "Between two grand and three grand, call it twenty five hundred pounds.";

    const prices = mod.extractStatedPrices(transcript);

    // Every extracted span must be verbatim
    for (const price of prices) {
      expect(transcript.includes(price.transcript_span)).toBe(true);
      // Should not contain normalised forms
      expect(price.transcript_span).not.toContain("thousand pounds");
    }
  });

  it("verbatim property holds across speaker-labelled turns", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "I'll charge three grand for labour. Materials are two hundred quid.";
    const turns = [
      { speaker: "contractor" as const, text: "I'll charge three grand for labour.", at: "2026-09-04T10:00:01.000Z" },
      { speaker: "contractor" as const, text: "Materials are two hundred quid.", at: "2026-09-04T10:00:05.000Z" },
    ];

    const prices = mod.extractStatedPrices(transcript, turns);

    expect(prices.length).toBeGreaterThan(0);

    // Every span must be verbatim from one of the turns
    for (const price of prices) {
      const foundInSomeTurn = turns.some(turn => turn.text.includes(price.transcript_span));
      expect(
        foundInSomeTurn,
        `transcript_span "${price.transcript_span}" not found verbatim in any turn`
      ).toBe(true);

      // Should not contain normalised form
      expect(price.transcript_span).not.toContain("thousand pounds");
    }
  });

  it("empty transcript returns empty array unchanged", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const prices = mod.extractStatedPrices("");

    expect(prices).toEqual([]);
  });

  it("unparseable input returns empty array unchanged", async () => {
    const mod = await import("@/lib/voice/stated-prices");

    const transcript = "No prices here, just a conversation about the weather.";

    const prices = mod.extractStatedPrices(transcript);

    expect(prices).toEqual([]);
  });
});
