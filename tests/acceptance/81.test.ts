import { describe, expect, it } from "vitest";
import {
  EMPTY_SOW_STATE,
  getUnansweredChecklistQuestions,
  getUnansweredRequiredChecklistQuestions,
  mergeSowDelta,
  resolvePricingMode,
  type SowDelta,
} from "@/lib/schemas/sow";
import { applyPricingMode } from "@/lib/pricing-mode";
import type { LineItem } from "@/lib/schemas/job";

const delta = (overrides: Partial<SowDelta> = {}): SowDelta => ({
  job_type: undefined,
  rooms: [],
  materials_mentioned: [],
  access_issues: undefined,
  existing_conditions: undefined,
  timeline: undefined,
  labour_plan: undefined,
  deadline: undefined,
  materials_supply: undefined,
  agreed_costs: undefined,
  pricing: undefined,
  inclusions: [],
  exclusions: [],
  additional_items: [],
  assumptions_and_unknowns: [],
  customer_name: undefined,
  site_address: undefined,
  customer_phone: undefined,
  customer_email: undefined,
  complete: false,
  next_question: undefined,
  ...overrides,
});

// Minimal calculated line item for testing applyPricingMode with legacy jobs
const calculatedLine: LineItem = {
  description: "Labour",
  category: "labour",
  quantity: 4,
  unit: "day",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  people: [{ label: "Owner", days: 4, day_rate: 340 }],
};

describe("Issue #81: Gate the pricing slot on pricing.mode being explicitly set", () => {
  describe("Duration mention alone does not satisfy the slot", () => {
    it("marks duration slot as unanswered when only duration_days is set", () => {
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: { people_count: null, duration_days: 4, crew_description: null },
        }),
      );

      // The duration slot should still be unanswered because pricing.mode was never set
      expect(getUnansweredChecklistQuestions(state)).toContain("duration");
      expect(getUnansweredRequiredChecklistQuestions(state)).toContain("duration");
    });

    it("marks duration slot as unanswered when duration_days is set with crew_description", () => {
      // "it'll be about four days" — incidental duration mention, no pricing mode discussion
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: { people_count: null, duration_days: 4, crew_description: "just me" },
        }),
      );

      expect(getUnansweredChecklistQuestions(state)).toContain("duration");
      expect(getUnansweredRequiredChecklistQuestions(state)).toContain("duration");
    });

    it("satisfies the slot only when pricing.mode is explicitly set", () => {
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: { people_count: null, duration_days: 4, crew_description: "just me" },
          pricing: { mode: "days", fixed_amount: null },
        }),
      );

      // Now the slot should be satisfied
      expect(getUnansweredChecklistQuestions(state)).not.toContain("duration");
      expect(getUnansweredRequiredChecklistQuestions(state)).not.toContain("duration");
    });

    it("satisfies the slot with pricing.mode set even without duration_days", () => {
      // Mode set to "calculated", no duration mentioned
      const state = mergeSowDelta(
        null,
        delta({
          pricing: { mode: "calculated", fixed_amount: null },
        }),
      );

      expect(getUnansweredChecklistQuestions(state)).not.toContain("duration");
    });
  });

  describe("resolvePricingMode returns null when mode is unset", () => {
    it("returns null when pricing is null", () => {
      const sow = { ...EMPTY_SOW_STATE, pricing: null };
      expect(resolvePricingMode(sow)).toBeNull();
    });

    it("returns the mode when pricing is set", () => {
      const sow = {
        ...EMPTY_SOW_STATE,
        pricing: { mode: "fixed" as const, fixed_amount: 2000 },
      };
      expect(resolvePricingMode(sow)).toBe("fixed");
    });

    it("returns 'days' when mode is days", () => {
      const sow = {
        ...EMPTY_SOW_STATE,
        pricing: { mode: "days" as const, fixed_amount: null },
      };
      expect(resolvePricingMode(sow)).toBe("days");
    });

    it("returns 'calculated' when explicitly set", () => {
      const sow = {
        ...EMPTY_SOW_STATE,
        pricing: { mode: "calculated" as const, fixed_amount: null },
      };
      expect(resolvePricingMode(sow)).toBe("calculated");
    });
  });

  describe("applyPricingMode handles null mode for legacy jobs", () => {
    it("produces calculated breakdown for legacy job with pricing: null", () => {
      // Legacy job: pricing was never set (pre-Task B)
      const sow = {
        ...EMPTY_SOW_STATE,
        job_type: "electrical",
        pricing: null,
      };

      // Should produce the calculated breakdown, not fail or return empty
      const result = applyPricingMode([calculatedLine], sow);
      expect(result).toEqual([calculatedLine]);
    });

    it("produces calculated breakdown when mode resolves to null but items exist", () => {
      // Another legacy scenario: pricing object missing
      const sow = {
        job_type: "plastering",
        pricing: null,
      };

      const result = applyPricingMode([calculatedLine], sow);
      // Should keep the calculated breakdown
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(calculatedLine);
    });
  });

  describe("Integration: wrap safety net still catches unset mode", () => {
    it("treats duration as required when mode is unset despite duration_days present", () => {
      // Scenario: contractor mentioned "four days" but was never asked how to price it
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: {
            people_count: 2,
            duration_days: 4,
            crew_description: "me and Liam",
          },
          materials_supply: {
            contractor_supplied: ["Cable"],
            customer_supplied: [],
          },
        }),
      );

      // Crew and materials_supply are answered, but duration (pricing mode) is not
      const unanswered = getUnansweredRequiredChecklistQuestions(state);
      expect(unanswered).toEqual(["duration"]);
    });

    it("does not block wrap when mode is set even without duration_days", () => {
      // Contractor chose "you work it out" (calculated mode), no duration stated
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: {
            people_count: 2,
            duration_days: null,
            crew_description: "me and a mate",
          },
          pricing: { mode: "calculated", fixed_amount: null },
          materials_supply: {
            contractor_supplied: [],
            customer_supplied: [],
          },
        }),
      );

      // All required slots satisfied
      expect(getUnansweredRequiredChecklistQuestions(state)).toEqual([]);
    });
  });
});
