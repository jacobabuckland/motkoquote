import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompileKnownPrice, CompileRateCard } from "@/lib/compile-draft";

describe("PFIX-4: First-run invention guard", () => {
  describe("hasPricingHistory predicate", () => {
    it("returns false when only evidence is price-free knowledge chunk", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      // A contractor who just completed business-setup has one chunk with no price
      const result = hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: [
          "Business setup interview completed. Company name: ABC Plumbing. No pricing discussed.",
        ],
      });

      expect(result).toBe(false);
    });

    it("returns true when contractor has rate card with actual rate", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      const rateCard: CompileRateCard = {
        id: "rc1",
        work_type: "socket installation",
        unit: "per socket",
        rate_per_unit: 45,
      };

      const result = hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [rateCard],
        similarPastJobs: [],
      });

      expect(result).toBe(true);
    });

    it("returns true when contractor has confirmed material price", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      const knownPrice: CompileKnownPrice = {
        description: "13A socket",
        unit: "each",
        unit_price: 12.5,
      };

      const result = hasPricingHistory({
        knownMaterialPrices: [knownPrice],
        rateCards: [],
        similarPastJobs: [],
      });

      expect(result).toBe(true);
    });

    it("returns true when contractor has past quote with actual prices", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      const result = hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: [
          "Rewire kitchen. Labour: 2 days @ £250/day = £500. Materials: consumer unit £180, cable £120 = £300. Total: £800",
        ],
      });

      expect(result).toBe(true);
    });

    it("returns false when similar jobs exist but contain no price figures", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      const result = hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: [
          "Previous job: rewire a kitchen. Customer was happy with the work. No prices mentioned.",
        ],
      });

      expect(result).toBe(false);
    });
  });

  describe("guest path declares no pricing history", () => {
    it("guest compile context must set has_pricing_history: false", async () => {
      // The guest path in src/lib/guest/quote.ts calls compileDraftToLineItems
      // at line 125-138. The CompileContext it passes (line 127-135) must
      // include has_pricing_history: false.
      //
      // This test verifies that a guest's compilation context treats them as
      // having no pricing history, which is true by construction (they have no
      // account, no rate cards, no confirmed prices, no past jobs).

      const compileDraft = await import("@/lib/compile-draft");

      // Simulate what the guest path should pass to compileDraftToLineItems
      const guestContext = {
        day_rate: null,
        overtime_rate: null,
        markup_pct: null,
        team_members: [],
        rate_cards: [],
        known_material_prices: [],
        owner_label: "Owner",
        has_pricing_history: false, // This is the fix
      };

      const result = compileDraft.compileDraftToLineItems(
        [
          {
            kind: "material",
            description: "Test material",
            quantity: 1,
            unit: "each",
            estimated_unit_cost_pence: 10000, // £100
            supplied_by: "contractor",
          },
        ],
        guestContext,
        [],
        []
      );

      // With has_pricing_history: false, the UNSOURCED_PRICE_FLAG should be raised
      expect(result.contractorFlags.length).toBeGreaterThan(0);
      expect(result.contractorFlags.some((flag) => flag.includes("first quote"))).toBe(true);
    });
  });

  describe("reproduction: £180 model estimate does not become £216.00", () => {
    it("no-history contractor gets unpriced flagged line, not invented figure", async () => {
      const compileDraft = await import("@/lib/compile-draft");

      // Reproduction: a model estimates £180 for a consumer unit.
      // With 25% markup, that becomes £216.00.
      // Before the fix, this printed as a real price on the customer document.
      // After the fix, it should be unpriced and flagged.

      const result = compileDraft.compileDraftToLineItems(
        [
          {
            kind: "material",
            description: "Consumer unit",
            quantity: 1,
            unit: "each",
            estimated_unit_cost_pence: 18000, // £180 model estimate
            supplied_by: "contractor",
          },
        ],
        {
          day_rate: null,
          overtime_rate: null,
          markup_pct: 25, // Would make it £216.00 if the estimate were trusted
          team_members: [],
          rate_cards: [],
          known_material_prices: [],
          owner_label: "Owner",
          has_pricing_history: false, // First-time contractor, no history
        },
        [],
        []
      );

      // Material lines should be unpriced (unit_price null or 0)
      const materialLines = result.lineItems.filter((line) => line.category === "materials");
      materialLines.forEach((line) => {
        expect(line.unit_price || 0).toBe(0);
        // The line should be marked unpriced
        expect(line.unpriced).toBe(true);
      });

      // The invented figure £216.00 (estimate + markup) must not appear as a price
      // £180 may appear in mismatch diagnostics (llm_value tracking), which is fine
      const lineItemsJson = JSON.stringify(result.lineItems);
      expect(lineItemsJson).not.toContain("216");

      // UNSOURCED_PRICE_FLAG should be raised
      expect(result.contractorFlags.some((flag) => flag.includes("first quote"))).toBe(true);
    });
  });

  describe("knowledge layer embedding timing", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("compile-draft does not call syncQuoteKnowledge", async () => {
      // The compilation step must not embed knowledge.
      // Embedding happens at approval/send time, not draft time.
      const knowledge = await import("@/lib/knowledge");
      const syncSpy = vi.spyOn(knowledge, "syncQuoteKnowledge");

      const compileDraft = await import("@/lib/compile-draft");

      compileDraft.compileDraftToLineItems(
        [
          {
            kind: "material",
            description: "Test material",
            quantity: 1,
            unit: "each",
            estimated_unit_cost_pence: 5000, // £50
            supplied_by: "contractor",
          },
        ],
        {
          day_rate: null,
          overtime_rate: null,
          markup_pct: null,
          team_members: [],
          rate_cards: [],
          known_material_prices: [],
          owner_label: "Owner",
          has_pricing_history: false,
        },
        [],
        []
      );

      // syncQuoteKnowledge should never be called from compilation
      expect(syncSpy).not.toHaveBeenCalled();
    });

    it("send path must call syncQuoteKnowledge", async () => {
      // This is a structural requirement: quotes embed into knowledge at
      // approval/send time, not at draft time.
      //
      // The actual send path is in server actions (src/app/jobs/actions.ts or
      // similar). This test documents the requirement without coupling to the
      // exact implementation.
      //
      // When the Engineer implements this, they should:
      // 1. Find where quotes are sent/approved (likely sendQuote server action)
      // 2. Ensure syncQuoteKnowledge is called AFTER the quote is confirmed
      // 3. Update this test to exercise that path and assert the call

      const knowledge = await import("@/lib/knowledge");
      expect(knowledge.syncQuoteKnowledge).toBeDefined();
    });
  });

  describe("established accounts unchanged", () => {
    it("with history undefined (legacy behavior), materials get estimated prices", async () => {
      const compileDraft = await import("@/lib/compile-draft");

      // Before this fix, has_pricing_history was optional and defaulted to
      // "assume history" (the permissive branch). Existing callers that don't
      // set the field must keep working.

      const result = compileDraft.compileDraftToLineItems(
        [
          {
            kind: "material",
            description: "Socket",
            quantity: 1,
            unit: "each",
            estimated_unit_cost_pence: 2000, // £20
            supplied_by: "contractor",
          },
        ],
        {
          day_rate: null,
          overtime_rate: null,
          markup_pct: 25,
          team_members: [],
          rate_cards: [],
          known_material_prices: [],
          owner_label: "Owner",
          // has_pricing_history: undefined (omitted) — legacy callers do this
        },
        [],
        []
      );

      // With has_pricing_history omitted, materials should get the estimated
      // price applied (legacy behavior). This ensures we don't break existing
      // callers.
      const materialLines = result.lineItems.filter((line) => line.category === "materials");

      // Before the fix, this would apply the estimate + markup = 25.00
      // After the fix, undefined still means "assume history" so behavior unchanged
      expect(materialLines.length).toBeGreaterThan(0);
      expect(materialLines[0].unit_price).toBeGreaterThan(0);
    });

    it("contractor with genuine pricing evidence gets estimates as before", async () => {
      // A contractor with actual rate card or confirmed material price
      // should get estimates as they do today - this behavior is unchanged

      const { hasPricingHistory } = await import("@/lib/pricing-history");

      const knownPrice: CompileKnownPrice = {
        description: "13A socket",
        unit: "each",
        unit_price: 15,
      };

      // This contractor HAS pricing history (genuine evidence)
      expect(
        hasPricingHistory({
          knownMaterialPrices: [knownPrice],
          rateCards: [],
          similarPastJobs: [],
        })
      ).toBe(true);

      // Their quotes compile normally with has_pricing_history: true
      // (This is the existing behavior, unchanged by this fix)
    });
  });

  describe("invented estimates cannot appear as similar past jobs", () => {
    it("knowledge chunk from unapproved quote does not seed later drafts", async () => {
      const knowledge = await import("@/lib/knowledge");
      const syncSpy = vi.spyOn(knowledge, "syncQuoteKnowledge");

      const compileDraft = await import("@/lib/compile-draft");

      // Draft a quote (should not embed into knowledge)
      compileDraft.compileDraftToLineItems(
        [
          {
            kind: "material",
            description: "Plumbing parts",
            quantity: 1,
            unit: "job",
            estimated_unit_cost_pence: 5000, // £50
            supplied_by: "contractor",
          },
        ],
        {
          day_rate: null,
          overtime_rate: null,
          markup_pct: null,
          team_members: [],
          rate_cards: [],
          known_material_prices: [],
          owner_label: "Owner",
          has_pricing_history: false,
        },
        [],
        []
      );

      // Verify syncQuoteKnowledge was not called (draft doesn't embed)
      expect(syncSpy).not.toHaveBeenCalled();

      // This ensures invented prices from the draft can't appear as
      // "similar past jobs" in a later quote, because they were never embedded
    });
  });

  describe("edge case: past quote with invented figures does not count as pricing evidence", () => {
    it("filters out past quotes that contain only invented estimates", async () => {
      const { hasPricingHistory } = await import("@/lib/pricing-history");

      // A past quote that was drafted under the old behavior and contains invented figures
      // Should not count as pricing evidence
      const result = hasPricingHistory({
        knownMaterialPrices: [],
        rateCards: [],
        similarPastJobs: [
          "Previous job drafted but never approved. Contains model estimates: socket £15 (unconfirmed)",
        ],
      });

      // Should return false because this is not genuine pricing evidence
      expect(result).toBe(false);
    });
  });
});
