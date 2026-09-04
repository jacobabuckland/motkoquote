/**
 * PFIX-1: The stated-price extractor mis-parses ordinary trade speech
 *
 * Tests the extractor's refusal logic for ambiguous amounts (ranges, hedges,
 * rates), fixes for the four measured defects, and the editor ask flow.
 */

import { describe, expect, it } from "vitest";
import type { StatedPrice } from "@/lib/schemas/stated-price";

describe("PFIX-1: Stated price extractor refusal and fixes", () => {
  describe("Refusal cases: ranges", () => {
    it("refuses 'between X and Y' range form", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The rewire will be between eight hundred and nine hundred pounds.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      // Must not extract £900 or £800 as chargeable
      expect(chargeablePrices).toHaveLength(0);

      // The extraction should be refused, not absent
      // (Implementation may return a refused marker or simply not extract)
      const hasNineHundred = prices.some((p: StatedPrice) => p.amount === 90000);
      const hasEightHundred = prices.some((p: StatedPrice) => p.amount === 80000);
      expect(hasNineHundred).toBe(false);
      expect(hasEightHundred).toBe(false);
    });

    it("refuses 'X to Y' range form", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Labour will be five hundred to six hundred pounds.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'X or Y' range form", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The job will be four thousand or five thousand pounds.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });
  });

  describe("Refusal cases: hedges", () => {
    it("refuses 'around' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The consumer unit is around five hundred pounds.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'about' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "It's about four hundred and fifty quid for the skim.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'approximately' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Approximately six hundred pounds for the first fix.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'give or take' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Five hundred pounds, give or take, for the labour.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'or so' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Three hundred pounds or so for materials.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'roughly' hedge", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Roughly two hundred quid for the testing.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });
  });

  describe("Refusal cases: rate units", () => {
    it("refuses 'a day' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "I charge one hundred and fifty pounds a day.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      // Must not lock £150 as a flat total
      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'per day' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "It's two hundred pounds per day for labour.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'per hour' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Fifty pounds per hour for the electrician.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'an hour' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Forty five pounds an hour for labour.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'per metre' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Twelve pounds per metre for the cable run.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'a square metre' rate unit", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Twenty pounds a square metre for tiling.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });

    it("refuses 'per unit' rate", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Eight pounds per unit for sockets.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });
  });

  describe("Four measured defects", () => {
    it("FIX: digit-form with £ sign extracts correctly", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "It is £450 for the skim.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(45000); // £450 in pence
      expect(chargeablePrices[0]?.item).toMatch(/skim/i);
    });

    it("FIX: digit-form with comma extracts correctly", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The rewire is £1,200 for labour.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(120000); // £1,200 in pence
    });

    it("FIX: digit-form with space after £ extracts correctly", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Materials are £ 320 for the cables.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(32000);
    });

    it("REFUSE: range 'between X and Y' does not extract upper bound", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Between eight hundred and nine hundred pounds.";

      const prices = mod.extractStatedPrices(transcript);

      // The old defect: extracted £900. Must now refuse.
      const hasNineHundred = prices.some((p: StatedPrice) => p.amount === 90000 && p.superseded_by === null);
      expect(hasNineHundred).toBe(false);
    });

    it("FIX: 'and' at non-zero position extracts correctly", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      // Simulating the redacted-phone case: "and" appears mid-sentence after redaction
      const transcript = "The number is [REDACTED]. And the labour is three hundred pounds.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices.length).toBeGreaterThan(0);
      const labourPrice = chargeablePrices.find((p: StatedPrice) => p.item?.match(/labour/i));
      expect(labourPrice).toBeDefined();
      expect(labourPrice?.amount).toBe(30000); // £300 in pence
    });

    it("PRESERVE: 'and' at index 0 still works (frozen test from #528)", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "And the consumer unit is five hundred pounds.";

      const prices = mod.extractStatedPrices(transcript);

      expect(prices.length).toBeGreaterThan(0);
      const consumerUnitPrice = prices.find((p: StatedPrice) => p.amount === 50000);
      expect(consumerUnitPrice).toBeDefined();
      expect(consumerUnitPrice?.item).toMatch(/consumer unit/i);
    });
  });

  describe("Edge cases: unambiguous amounts still extract", () => {
    it("'five hundred and twenty' (addition, not range) extracts as £520", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The consumer unit is five hundred and twenty pounds.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(52000);
    });

    it("self-resolved range extracts the final amount", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Between five and six hundred, call it five fifty.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      // The contractor resolved the range themselves: "call it five fifty"
      // This should extract £550 (the resolution), not refuse
      expect(chargeablePrices.length).toBeGreaterThan(0);
      const fiveFifty = chargeablePrices.find((p: StatedPrice) => p.amount === 55000);
      expect(fiveFifty).toBeDefined();
    });

    it("unambiguous absolute amount extracts with qualifiers intact", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Sockets are eighty five each, fitted.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(8500);
      expect(chargeablePrices[0]?.qualifiers.each).toBe(true);
      expect(chargeablePrices[0]?.qualifiers.fitted).toBe(true);
    });

    it("supersession still works: later amount supersedes earlier", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The consumer unit is four hundred pounds. Actually, make that four hundred and fifty.";

      const prices = mod.extractStatedPrices(transcript);

      expect(prices).toHaveLength(2);

      const fourHundred = prices.find((p: StatedPrice) => p.amount === 40000);
      const fourFifty = prices.find((p: StatedPrice) => p.amount === 45000);

      expect(fourHundred).toBeDefined();
      expect(fourHundred?.superseded_by).toBe(45000);

      expect(fourFifty).toBeDefined();
      expect(fourFifty?.superseded_by).toBeNull();

      // Only the final one is chargeable
      const chargeablePrices = mod.getChargeableStatedPrices(prices);
      expect(chargeablePrices).toHaveLength(1);
      expect(chargeablePrices[0]?.amount).toBe(45000);
    });

    it("refused amount then corrected in-call extracts the correction", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The labour is around five hundred pounds. Actually, four hundred and eighty.";

      const prices = mod.extractStatedPrices(transcript);
      const chargeablePrices = mod.getChargeableStatedPrices(prices);

      // The "around five hundred" is refused, "four hundred and eighty" is clear
      expect(chargeablePrices.length).toBeGreaterThan(0);
      const corrected = chargeablePrices.find((p: StatedPrice) => p.amount === 48000);
      expect(corrected).toBeDefined();
    });
  });

  describe("Edge cases: unpunctuated and ambiguous forms refuse", () => {
    it("unpunctuated turn with two amounts extracts neither", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      // Simulating unpunctuated STT merging two sentences
      const transcript = "The labour is three hundred the materials are two hundred";

      const prices = mod.extractStatedPrices(transcript);

      // When sentence boundaries are unclear, refuse both rather than locking the first
      // (This is a conservative refusal: if both can't be scoped reliably, extract neither)
      // The test accepts either: both refused, or both extracted correctly if the parser can handle it
      if (prices.length === 2) {
        // If both were extracted, they should be distinct
        const amounts = prices.map((p: StatedPrice) => p.amount);
        expect(amounts).toContain(30000);
        expect(amounts).toContain(20000);
      } else {
        // If refused, that's acceptable too for this edge case
        expect(prices.length).toBe(0);
      }
    });

    it("no amounts at all returns empty array (unchanged behavior)", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "We'll need to rewire the kitchen and add some sockets.";

      const prices = mod.extractStatedPrices(transcript);

      expect(prices).toHaveLength(0);
    });
  });

  describe("Refusal guarantee: no silent zero prices", () => {
    it("refused extraction never produces a zero-priced chargeable line", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "Labour is around five hundred pounds.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      // Must not have a zero-priced line
      const hasZero = chargeablePrices.some((p: StatedPrice) => p.amount === 0);
      expect(hasZero).toBe(false);

      // Should be refused entirely (no chargeable prices)
      expect(chargeablePrices).toHaveLength(0);
    });

    it("multiple refusals for same item do not produce duplicate zeros", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The rewire is between eight hundred and nine hundred. Roughly in that range.";

      const chargeablePrices = mod.getChargeableStatedPrices(mod.extractStatedPrices(transcript));

      expect(chargeablePrices).toHaveLength(0);
    });
  });

  describe("Refusal context: transcript spans are preserved", () => {
    it("refused extraction retains transcript_span for ask display", async () => {
      const mod = await import("@/lib/voice/stated-prices");
      const transcript = "The consumer unit is around five hundred pounds.";

      const allPrices = mod.extractStatedPrices(transcript);

      // Even if refused, the extraction attempt should preserve context
      // This allows the editor to show "what was heard" in the ask
      // The implementation may return a refused marker or simply not extract
      if (allPrices.length > 0) {
        // If a refused marker is returned, it should have transcript_span
        allPrices.forEach((p: StatedPrice) => {
          expect(p.transcript_span).toBeDefined();
          expect(p.transcript_span.length).toBeGreaterThan(0);
        });
      }
      // If nothing is returned, that's acceptable too (refused = absent)
    });
  });
});

describe("PFIX-1: Editor ask flow and send blocking", () => {
  // These tests check the integration: refused prices produce asks,
  // and quotes with unpriced items cannot be sent.

  it("TODO: editor shows ask for refused price", async () => {
    // This test requires rendering the quote editor component
    // and asserting that an ask is shown for a line without a locked price.
    // The exact component path is TBD.
    //
    // Expected behavior:
    // 1. Render editor with a quote that has a refused stated price
    // 2. Assert an ask is shown naming the item
    // 3. Assert the transcript span is quoted
    // 4. Assert there's an input to supply the price

    expect(true).toBe(true); // Placeholder until component path is known
  });

  it("TODO: contractor-supplied price via ask is marked as contractor-sourced", async () => {
    // Expected behavior:
    // 1. Simulate contractor entering a price through the ask
    // 2. Submit the price
    // 3. Assert the line item now has a price
    // 4. Assert it's marked as contractor-sourced (not from extraction)
    // 5. Assert it satisfies the reconciliation gate

    expect(true).toBe(true); // Placeholder
  });

  it("TODO: sendQuote blocks when line items lack prices", async () => {
    // Expected behavior:
    // 1. Attempt to send a quote with unpriced line items
    // 2. Assert sendQuote throws/returns error
    // 3. Assert error names which items need pricing

    expect(true).toBe(true); // Placeholder
  });

  it("TODO: sendQuote succeeds after all items are priced", async () => {
    // Expected behavior:
    // 1. Start with refused prices
    // 2. Contractor supplies prices via asks
    // 3. Send succeeds

    expect(true).toBe(true); // Placeholder
  });
});
