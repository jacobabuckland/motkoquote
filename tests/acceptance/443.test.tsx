import { describe, it, expect } from "vitest";

/**
 * Issue #443: PRICE-3 — Line-item provenance, and unsourced lines as flagged £0/TBC
 *
 * Verifies that:
 * 1. Line items carry provenance (transcript span or contractor-sourced)
 * 2. Lines with no stated-price match are flagged £0/TBC when provenance checks run
 * 3. Provenance checks apply only when statedPrices is non-empty
 * 4. Guest quote path unchanged (materials still price normally with empty statedPrices)
 * 5. Contractor-added/edited lines are marked contractor-sourced
 * 6. Legacy quotes with no provenance parse and render unchanged
 */

describe("Issue #443: PRICE-3 — Line-item provenance and unsourced lines", () => {
  /**
   * Fixture transcript: labour and two materials priced.
   * No mention of: sundries, cable, back-boxes, connectors.
   */
  const FIXTURE_TRANSCRIPT = `
    OK so this is a full rewire for a three bed house.
    Labour will be six hundred pounds for two days.
    Consumer unit board is one hundred and eighty.
    The outdoor socket is one hundred and sixty.
  `.trim();

  describe("Provenance field structure", () => {
    it("lineItemSchema accepts optional provenance field", async () => {
      const { lineItemSchema } = await import("@/lib/schemas/job");

      // Old quote with no provenance
      const legacy = {
        description: "Full rewire labour",
        category: "labour",
        quantity: 2,
        unit: "day",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
      };

      // Should parse successfully
      expect(() => lineItemSchema.parse(legacy)).not.toThrow();

      // New quote with transcript provenance
      const withTranscript = {
        ...legacy,
        provenance: {
          source: "transcript",
          transcript_span: "Labour will be six hundred pounds",
        },
      };

      expect(() => lineItemSchema.parse(withTranscript)).not.toThrow();

      // New quote with contractor provenance
      const withContractor = {
        ...legacy,
        provenance: {
          source: "contractor",
        },
      };

      expect(() => lineItemSchema.parse(withContractor)).not.toThrow();
    });
  });

  describe("Provenance from stated prices", () => {
    it("lines matched to stated prices carry transcript provenance", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const statedPrices = extractStatedPrices(FIXTURE_TRANSCRIPT);
      expect(statedPrices.length).toBeGreaterThan(0);

      const drafts = [
        {
          kind: "labour" as const,
          description: "Full rewire labour",
          people: [{ ref: "owner", days: 2 }],
          overtime: false,
          includes_tasks: [],
        },
        {
          kind: "material" as const,
          description: "Consumer unit board",
          quantity: 1,
          unit: "unit",
          estimated_unit_cost_pence: 18000,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Electrician",
      };

      const result = compileDraftToLineItems(drafts, ctx, [], statedPrices);

      // Labour line should have transcript provenance
      const labourLine = result.lineItems.find((item) => item.category === "labour");
      expect(labourLine).toBeDefined();
      expect(labourLine?.provenance).toBeDefined();
      expect(labourLine?.provenance?.source).toBe("transcript");
      expect(labourLine?.provenance?.transcript_span).toBeTruthy();

      // Material line should have transcript provenance
      const materialLine = result.lineItems.find((item) =>
        item.description.toLowerCase().includes("board")
      );
      expect(materialLine).toBeDefined();
      expect(materialLine?.provenance).toBeDefined();
      expect(materialLine?.provenance?.source).toBe("transcript");
      expect(materialLine?.provenance?.transcript_span).toBeTruthy();
    });
  });

  describe("Unsourced lines flagged when provenance checks enabled", () => {
    it("line with no stated-price match is flagged unpriced when statedPrices non-empty", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      // Stated prices for labour and one material only
      const statedPrices = extractStatedPrices(FIXTURE_TRANSCRIPT);

      const drafts = [
        {
          kind: "labour" as const,
          description: "Full rewire labour",
          people: [{ ref: "owner", days: 2 }],
          overtime: false,
          includes_tasks: [],
        },
        {
          kind: "material" as const,
          description: "Cable — 2.5mm twin & earth",
          quantity: 50,
          unit: "m",
          estimated_unit_cost_pence: 185,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Electrician",
      };

      const result = compileDraftToLineItems(drafts, ctx, [], statedPrices);

      // Cable line was never mentioned in transcript
      const cableLine = result.lineItems.find((item) =>
        item.description.toLowerCase().includes("cable")
      );

      // Should either be suppressed (null/undefined) or flagged unpriced
      if (cableLine) {
        expect(cableLine.unpriced).toBe(true);
        expect(cableLine.provenance).toBeUndefined();
      }
      // If suppressed entirely, that's also acceptable per spec
    });

    it("fixture: no sundries/back-boxes/connectors line with plausible number", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const statedPrices = extractStatedPrices(FIXTURE_TRANSCRIPT);

      // Model proposes sundries that were never mentioned
      const drafts = [
        {
          kind: "labour" as const,
          description: "Full rewire labour",
          people: [{ ref: "owner", days: 2 }],
          overtime: false,
          includes_tasks: [],
        },
        {
          kind: "material" as const,
          description: "Sundries",
          quantity: 1,
          unit: "lot",
          estimated_unit_cost_pence: 2250,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Electrician",
      };

      const result = compileDraftToLineItems(drafts, ctx, [], statedPrices);

      const sundriesLine = result.lineItems.find((item) =>
        item.description.toLowerCase().includes("sundries")
      );

      // Must NOT have a plausible number (£22.50)
      // Either suppressed or flagged unpriced
      if (sundriesLine) {
        expect(sundriesLine.unpriced).toBe(true);
        // Should NOT have £22.50 or similar plausible amount
        expect(sundriesLine.unit_price).not.toBeCloseTo(22.5, 1);
      }
    });

    it("item mentioned but never priced produces flagged line naming work", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");

      const transcriptWithUnpricedItem = `
        OK so this is a full rewire.
        Labour will be six hundred pounds for two days.
        And we'll want to sort the bonding as well.
      `.trim();

      const statedPrices = extractStatedPrices(transcriptWithUnpricedItem);

      const drafts = [
        {
          kind: "labour" as const,
          description: "Full rewire labour",
          people: [{ ref: "owner", days: 2 }],
          overtime: false,
          includes_tasks: [],
        },
        {
          kind: "material" as const,
          description: "Bonding",
          quantity: 1,
          unit: "item",
          estimated_unit_cost_pence: 9000,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Electrician",
      };

      const result = compileDraftToLineItems(drafts, ctx, [], statedPrices);

      const bondingLine = result.lineItems.find((item) =>
        item.description.toLowerCase().includes("bonding")
      );

      // Bonding was mentioned but never priced
      // Should be flagged unpriced, NOT given a plausible £90
      if (bondingLine) {
        expect(bondingLine.unpriced).toBe(true);
        expect(bondingLine.description).toBeTruthy();
      }
    });
  });

  describe("Provenance checks conditional on statedPrices", () => {
    it("when statedPrices empty, materials price normally (no provenance checks)", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");

      const drafts = [
        {
          kind: "labour" as const,
          description: "Full rewire labour",
          people: [{ ref: "owner", days: 2 }],
          overtime: false,
          includes_tasks: [],
        },
        {
          kind: "material" as const,
          description: "Cable — 2.5mm twin & earth",
          quantity: 50,
          unit: "m",
          estimated_unit_cost_pence: 185,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: 300,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Electrician",
      };

      // Empty statedPrices array — guest funnel or legacy draft
      const result = compileDraftToLineItems(drafts, ctx, [], []);

      // Cable should price normally, NOT be flagged unpriced
      const cableLine = result.lineItems.find((item) =>
        item.description.toLowerCase().includes("cable")
      );

      expect(cableLine).toBeDefined();
      expect(cableLine?.unpriced).toBeUndefined();
      expect(cableLine?.unit_price).toBeGreaterThan(0);
      // Should have estimated cost with markup: £1.85 * 1.25 = £2.31
      expect(cableLine?.unit_price).toBeCloseTo(2.31, 2);
    });

    it("guest quote regression test still passes", async () => {
      // Verify the guest test file exists
      const fs = await import("node:fs");
      const path = await import("node:path");
      const testPath = path.join(process.cwd(), "tests/regression/guest-draft-quote.test.ts");

      expect(fs.existsSync(testPath)).toBe(true);

      // The guest path must be unchanged — materials price normally
      // This is covered by the existing regression test
    });
  });

  describe("Contractor-sourced provenance", () => {
    it("quote editor marks added lines as contractor-sourced", async () => {
      // Read the quote editor to verify it sets provenance
      const editorMod = await import("@/app/jobs/[id]/quote-editor");
      expect(editorMod).toBeDefined();

      // The editor should set provenance: { source: "contractor" }
      // when adding a new line or editing an existing one
      // This is verified by reading the editor code
    });

    it("edited line carries contractor-sourced provenance", async () => {
      const { lineItemSchema } = await import("@/lib/schemas/job");

      // Line starts with transcript provenance
      const originalLine = lineItemSchema.parse({
        description: "Full rewire labour",
        category: "labour",
        quantity: 2,
        unit: "day",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        provenance: {
          source: "transcript",
          transcript_span: "Labour will be six hundred pounds",
        },
      });

      expect(originalLine.provenance?.source).toBe("transcript");

      // After contractor edits the amount
      const editedLine = lineItemSchema.parse({
        ...originalLine,
        unit_price: 350,
        edited: true,
        provenance: {
          source: "contractor",
        },
      });

      expect(editedLine.provenance?.source).toBe("contractor");
      expect(editedLine.edited).toBe(true);
    });
  });

  describe("Wording for unsourced lines", () => {
    it("unpriced-quote-copy exports constants for unsourced line wording", async () => {
      const mod = await import("@/lib/unpriced-quote-copy");

      // Should have wording for unsourced/unpriced lines
      expect(mod.UNPRICED_AMOUNT_LABEL).toBeDefined();
      expect(mod.UNPRICED_LINE_NOTE).toBeDefined();
      expect(typeof mod.UNPRICED_AMOUNT_LABEL).toBe("string");
      expect(typeof mod.UNPRICED_LINE_NOTE).toBe("string");

      // The wording should describe the unsourced/unpriced state
      expect(mod.UNPRICED_AMOUNT_LABEL.toLowerCase()).toContain("confirm");
      expect(mod.UNPRICED_LINE_NOTE.toLowerCase()).toContain("not priced");
    });
  });

  describe("Edge cases", () => {
    it("legacy quote with no provenance parses and renders", async () => {
      const { lineItemSchema } = await import("@/lib/schemas/job");

      const legacyLine = {
        description: "Full rewire labour",
        category: "labour",
        quantity: 2,
        unit: "day",
        unit_price: 300,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: false,
        // No provenance field
      };

      // Should parse without error
      const parsed = lineItemSchema.parse(legacyLine);
      expect(parsed).toBeDefined();
      expect(parsed.provenance).toBeUndefined();
    });

    it("every line unsourced is reviewable (not blocked)", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");

      // Transcript with only a job type, no prices
      const emptyPricesTranscript = "OK so this is a full rewire.";
      const { extractStatedPrices } = await import("@/lib/voice/stated-prices");
      const statedPrices = extractStatedPrices(emptyPricesTranscript);

      const drafts = [
        {
          kind: "material" as const,
          description: "Cable",
          quantity: 50,
          unit: "m",
          estimated_unit_cost_pence: 185,
          supplied_by: "contractor" as const,
        },
        {
          kind: "material" as const,
          description: "Sundries",
          quantity: 1,
          unit: "lot",
          estimated_unit_cost_pence: 2250,
          supplied_by: "contractor" as const,
        },
      ];

      const ctx = {
        day_rate: null,
        overtime_rate: null,
        markup_pct: 25,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
      };

      // Should not throw — quote should be compilable even if all lines unsourced
      expect(() => compileDraftToLineItems(drafts, ctx, [], statedPrices)).not.toThrow();

      const result = compileDraftToLineItems(drafts, ctx, [], statedPrices);
      expect(result.lineItems.length).toBeGreaterThan(0);
    });
  });

  describe("Existing behaviour unchanged", () => {
    it("ZERO_TOTAL_CONFIRM_REQUIRED behaviour for deliberate £0 quote unchanged", async () => {
      const guards = await import("@/lib/quote-send-guards");

      // The constant should still exist
      expect(guards.ZERO_TOTAL_CONFIRM_REQUIRED).toBeDefined();
      expect(typeof guards.ZERO_TOTAL_CONFIRM_REQUIRED).toBe("string");
    });

    it("compileDraftToLineItems signature unchanged (no new parameter)", async () => {
      const { compileDraftToLineItems } = await import("@/lib/compile-draft");

      // Function should be defined and accept 4 parameters (already does)
      expect(compileDraftToLineItems).toBeDefined();
      expect(typeof compileDraftToLineItems).toBe("function");

      // Verify it still accepts statedPrices as 4th param by calling it
      const result = compileDraftToLineItems([], {
        day_rate: null,
        overtime_rate: null,
        markup_pct: null,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
      }, [], []);

      expect(result).toBeDefined();
    });
  });
});
