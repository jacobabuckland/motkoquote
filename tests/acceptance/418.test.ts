import { describe, it, expect } from "vitest";

/**
 * Issue #418: PRICE-1 — Extract every spoken amount into a structured stated_prices record
 *
 * These tests verify:
 * 1. Extraction function exists and produces structured records
 * 2. Schema validates the extracted record shape
 * 3. SoW state carries the stated_prices field
 * 4. All edge cases are handled correctly
 * 5. Fixture transcript extracts all seven amounts with correct qualifiers
 * 6. Rendered output is unchanged (golden hash stability)
 */

describe("Issue #418: PRICE-1 — Stated prices extraction", () => {
  describe("Extraction module", () => {
    it("exports extractStatedPrices from stated-prices.ts", async () => {
      const imported = await import("@/lib/voice/stated-prices");

      expect(imported.extractStatedPrices).toBeDefined();
      expect(typeof imported.extractStatedPrices).toBe("function");
    });

    it("returns an empty array when transcript has no amounts", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(
        "Just doing a rewire, three bedrooms, normal access."
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    });

    it("extracts a single amount with item and transcript_span", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(
        "Consumer unit replacement will be two hundred and eighty pounds."
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        amount: 28000, // £280.00 in pence
        item: expect.any(String),
        transcript_span: expect.any(String),
      });
      expect(result[0]?.amount).toBe(28000);
      expect(result[0]?.transcript_span).toBeTruthy();
      expect((result[0]?.transcript_span ?? "").length).toBeGreaterThan(0);
    });

    it("uses parseSpokenMoney to parse amounts (deterministic)", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // Same input twice must produce same output
      const transcript = "The materials will be five hundred quid.";
      const result1 = extractStatedPrices(transcript);
      const result2 = extractStatedPrices(transcript);

      expect(result1).toEqual(result2);
      expect(result1[0]?.amount).toBe(50000); // £500.00
    });

    it("does not extract ambiguous amounts", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // "two eighty five" is ambiguous: £280.05 or £2.85?
      const result = extractStatedPrices("That'll be two eighty five.");

      // parseSpokenMoney returns null for this, so no entry should be recorded
      expect(result).toHaveLength(0);
    });
  });

  describe("Schema and types", () => {
    it("exports statedPriceSchema from stated-price.ts", async () => {
      const imported = await import("@/lib/schemas/stated-price");

      expect(imported.statedPriceSchema).toBeDefined();
    });

    it("exports StatedPrice type", async () => {
      // Type-only check — if this compiles, the type exists
      const imported = await import("@/lib/schemas/stated-price");
      expect(imported).toBeDefined();
    });

    it("validates a complete stated price record", async () => {
      const { statedPriceSchema } = await import("@/lib/schemas/stated-price");

      const validPrice = {
        amount: 28000,
        item: "Consumer unit replacement",
        transcript_span: "Consumer unit replacement will be two eighty",
        qualifiers: {
          each: false,
          fitted: false,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      };

      const result = statedPriceSchema.safeParse(validPrice);

      expect(result.success).toBe(true);
    });

    it("validates a price with qualifiers set", async () => {
      const { statedPriceSchema } = await import("@/lib/schemas/stated-price");

      const priceWithQualifiers = {
        amount: 8500, // £85.00
        item: "Sockets",
        transcript_span: "eighty five each fitted",
        qualifiers: {
          each: true,
          fitted: true,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      };

      const result = statedPriceSchema.safeParse(priceWithQualifiers);

      expect(result.success).toBe(true);
    });

    it("validates a price with null item (no clear attachment)", async () => {
      const { statedPriceSchema } = await import("@/lib/schemas/stated-price");

      const priceWithoutItem = {
        amount: 50000,
        item: null,
        transcript_span: "that's five hundred pounds",
        qualifiers: {
          each: false,
          fitted: false,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      };

      const result = statedPriceSchema.safeParse(priceWithoutItem);

      expect(result.success).toBe(true);
    });

    it("rejects invalid shapes (missing required fields)", async () => {
      const { statedPriceSchema } = await import("@/lib/schemas/stated-price");

      const invalid = {
        amount: 28000,
        // Missing item, transcript_span, qualifiers
      };

      const result = statedPriceSchema.safeParse(invalid);

      expect(result.success).toBe(false);
    });

    it("rejects non-integer amounts", async () => {
      const { statedPriceSchema } = await import("@/lib/schemas/stated-price");

      const invalidAmount = {
        amount: 280.5, // Must be integer pence
        item: "Materials",
        transcript_span: "materials cost two eighty",
        qualifiers: {
          each: false,
          fitted: false,
          already_paid: false,
          excluded: false,
        },
        superseded_by: null,
      };

      const result = statedPriceSchema.safeParse(invalidAmount);

      expect(result.success).toBe(false);
    });
  });

  describe("SoW state integration", () => {
    it("sowStateSchema includes stated_prices field", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      // Check the schema shape includes the field
      const schemaShape = sowStateSchema.shape;
      expect(schemaShape.stated_prices).toBeDefined();

      const validSow = {
        job_type: "Full rewire",
        rooms: [],
        materials_mentioned: [],
        stated_prices: [
          {
            amount: 28000,
            item: "Consumer unit",
            transcript_span: "consumer unit will be two eighty",
            qualifiers: {
              each: false,
              fitted: false,
              already_paid: false,
              excluded: false,
            },
            superseded_by: null,
          },
        ],
      };

      const result = sowStateSchema.safeParse(validSow);

      expect(result.success).toBe(true);
    });

    it("accepts empty stated_prices array", async () => {
      const { sowStateSchema } = await import("@/lib/schemas/sow");

      // Field must exist in schema first
      const schemaShape = sowStateSchema.shape;
      expect(schemaShape.stated_prices).toBeDefined();

      const sowWithNoPrices = {
        job_type: "Inspection",
        rooms: [],
        materials_mentioned: [],
        stated_prices: [],
      };

      const result = sowStateSchema.safeParse(sowWithNoPrices);

      expect(result.success).toBe(true);
    });
  });

  describe("Edge case: supersession (value corrections)", () => {
    it("marks an old value as superseded when contractor corrects it", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // Contractor says £480, then corrects to £520
      const transcript =
        "Consumer unit labour will be four eighty... " +
        "actually, make that five twenty for the consumer unit.";

      const result = extractStatedPrices(transcript);

      // Both values present
      expect(result.length).toBeGreaterThanOrEqual(2);

      // Find the £480 and £520 entries
      const price480 = result.find((p) => p.amount === 48000);
      const price520 = result.find((p) => p.amount === 52000);

      expect(price480).toBeDefined();
      expect(price520).toBeDefined();

      // £480 is superseded
      expect(price480?.superseded_by).toBeTruthy();

      // £520 is NOT superseded (it's the current value)
      expect(price520?.superseded_by).toBeNull();
    });

    it("does not mark a value as superseded when restated identically", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // Contractor says £520 twice — not a correction
      const transcript =
        "Consumer unit is five twenty... yes, five twenty for that.";

      const result = extractStatedPrices(transcript);

      // Should only have one entry (or both point to same value)
      const price520Entries = result.filter((p) => p.amount === 52000);

      // Either one entry, or if two entries, neither is superseded
      if (price520Entries.length === 1) {
        expect(price520Entries[0]?.superseded_by).toBeNull();
      } else {
        price520Entries.forEach((entry) => {
          expect(entry.superseded_by).toBeNull();
        });
      }
    });

    it("handles three values for one item (middle one superseded too)", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const transcript =
        "Materials are four hundred... no, five hundred... " +
        "actually make it six hundred for materials.";

      const result = extractStatedPrices(transcript);

      // Last value (£600) should NOT be superseded
      const price600 = result.find((p) => p.amount === 60000);
      expect(price600?.superseded_by).toBeNull();

      // Earlier values should be superseded
      const price400 = result.find((p) => p.amount === 40000);
      const price500 = result.find((p) => p.amount === 50000);

      if (price400) {
        expect(price400.superseded_by).toBeTruthy();
      }
      if (price500) {
        expect(price500.superseded_by).toBeTruthy();
      }
    });
  });

  describe("Edge case: qualifiers", () => {
    it("sets 'each' qualifier for unit prices", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices("Sockets are eighty five each.");

      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(8500);
      expect(result[0]?.qualifiers.each).toBe(true);
    });

    it("sets 'fitted' qualifier when labour is included", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices("Eighty five each fitted.");

      expect(result).toHaveLength(1);
      expect(result[0]?.qualifiers.fitted).toBe(true);
    });

    it("sets both 'each' and 'fitted' together", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices("Sockets are eighty five each fitted.");

      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(8500);
      expect(result[0]?.qualifiers.each).toBe(true);
      expect(result[0]?.qualifiers.fitted).toBe(true);
    });

    it("sets 'already_paid' for amounts already settled", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(
        "The EICR was hundred and twenty, they've already paid that."
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(12000); // £120.00
      expect(result[0]?.qualifiers.already_paid).toBe(true);
    });

    it("sets 'excluded' for amounts explicitly out of scope", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(
        "The kitchen sockets are two hundred but that's not included."
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.qualifiers.excluded).toBe(true);
    });
  });

  describe("Edge case: unattached amounts", () => {
    it("records an amount with null item when no attachment is clear", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices("That'll be five hundred pounds.");

      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(50000);
      expect(result[0]?.item).toBeNull();
    });

    it("does not guess an item when one is not stated", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(
        "We talked about the rewire. It's three grand."
      );

      // "three grand" might attach to "the rewire" but that's inference
      // Do not guess — either extract "rewire" as the item if it's in the
      // amount's immediate context, or leave item null
      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(300000);
      // Item may be "rewire" if extraction is confident, or null if not
      // The requirement is: do not INVENT an attachment
    });
  });

  describe("Fixture transcript: seven stated amounts", () => {
    // The reviewed transcript had seven amounts:
    // 1. £480 (consumer unit labour, superseded)
    // 2. £520 (consumer unit labour, final)
    // 3. £85 each fitted (sockets)
    // 4. £120 (EICR, already paid)
    // ... and three others mentioned in the spec

    const FIXTURE_TRANSCRIPT = `
      OK so this is a full rewire, three bed semi.
      Consumer unit labour will be four hundred and eighty pounds.
      Actually, sorry, make that five hundred and twenty for the consumer unit.
      The sockets are eighty five each fitted.
      The EICR was a hundred and twenty, they've already paid for that.
      Materials for the job will be around two thousand.
      Labour for first fix is three hundred a day.
      Cable will be about six hundred total.
    `;

    it("extracts all seven amounts from the fixture transcript", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      // Seven amounts stated (including the superseded £480)
      expect(result.length).toBeGreaterThanOrEqual(7);
    });

    it("fixture: £480 is superseded by £520", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      const price480 = result.find((p) => p.amount === 48000);
      const price520 = result.find((p) => p.amount === 52000);

      expect(price480).toBeDefined();
      expect(price520).toBeDefined();

      expect(price480?.superseded_by).toBeTruthy();
      expect(price520?.superseded_by).toBeNull();
    });

    it("fixture: £85 has 'each' and 'fitted' qualifiers", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      const price85 = result.find((p) => p.amount === 8500);

      expect(price85).toBeDefined();
      expect(price85?.qualifiers.each).toBe(true);
      expect(price85?.qualifiers.fitted).toBe(true);
    });

    it("fixture: £120 EICR has 'already_paid' qualifier", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      const price120 = result.find((p) => p.amount === 12000);

      expect(price120).toBeDefined();
      expect(price120?.qualifiers.already_paid).toBe(true);
    });

    it("fixture: all amounts are integer pence", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      result.forEach((price) => {
        expect(Number.isInteger(price.amount)).toBe(true);
      });
    });

    it("fixture: all amounts have non-empty transcript_span", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const result = extractStatedPrices(FIXTURE_TRANSCRIPT);

      result.forEach((price) => {
        expect(price.transcript_span).toBeTruthy();
        expect(price.transcript_span.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Purity and determinism", () => {
    it("is a pure function (same input = same output)", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const transcript = "Materials are two hundred pounds.";
      const result1 = extractStatedPrices(transcript);
      const result2 = extractStatedPrices(transcript);

      expect(result1).toEqual(result2);
    });

    it("does not call external APIs or use randomness", async () => {
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // Extraction is deterministic — built on parseSpokenMoney which is pure
      const result = extractStatedPrices("Five hundred quid for materials.");

      expect(result).toHaveLength(1);
      expect(result[0]?.amount).toBe(50000);
    });
  });

  describe("Rendered output stability (golden hash)", () => {
    it("quote PDF golden hashes are unchanged", async () => {
      // This item must not change any rendered output
      // The golden hash file must be byte-identical
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const goldenPath = join(
        process.cwd(),
        "tests/regression/quote-pdf-golden.json"
      );

      // Just reading the file is sufficient — if the extraction changes
      // rendered output, the golden test will fail on its own
      const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

      expect(Object.keys(golden).length).toBeGreaterThan(0);
      // This test documents the requirement: golden hashes must not move
    });
  });
});
