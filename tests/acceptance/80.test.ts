import { describe, expect, it } from "vitest";
import {
  getUnansweredChecklistQuestions,
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

describe("Issue 80: Gate pricing slot on pricing.mode being explicitly set", () => {
  describe("Slot-filling logic", () => {
    it("does not satisfy the duration slot when only duration_days is set", () => {
      // Incidental duration mention: "it'll be about four days"
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: { people_count: null, duration_days: 4, crew_description: null },
        }),
      );

      const unanswered = getUnansweredChecklistQuestions(state);

      // The duration slot should still be unanswered because pricing.mode is not set
      expect(unanswered).toContain("duration");
      expect(state.pricing).toBeNull();
    });

    it("satisfies the duration slot when pricing.mode is explicitly set to 'days'", () => {
      const state = mergeSowDelta(
        null,
        delta({
          labour_plan: { people_count: 2, duration_days: 4, crew_description: "me and Liam" },
          pricing: { mode: "days", fixed_amount: null },
        }),
      );

      const unanswered = getUnansweredChecklistQuestions(state);
      expect(unanswered).not.toContain("duration");
    });

    it("satisfies the duration slot when pricing.mode is explicitly set to 'fixed'", () => {
      const state = mergeSowDelta(
        null,
        delta({
          pricing: { mode: "fixed", fixed_amount: 2000 },
        }),
      );

      const unanswered = getUnansweredChecklistQuestions(state);
      expect(unanswered).not.toContain("duration");
    });

    it("satisfies the duration slot when pricing.mode is explicitly set to 'calculated'", () => {
      // User deflects: "you work it out"
      const state = mergeSowDelta(
        null,
        delta({
          pricing: { mode: "calculated", fixed_amount: null },
        }),
      );

      const unanswered = getUnansweredChecklistQuestions(state);
      expect(unanswered).not.toContain("duration");
    });

    it("satisfies the duration slot with pricing.mode even without duration_days", () => {
      // User states pricing mode but not duration
      const state = mergeSowDelta(
        null,
        delta({
          pricing: { mode: "fixed", fixed_amount: 2500 },
        }),
      );

      const unanswered = getUnansweredChecklistQuestions(state);
      expect(unanswered).not.toContain("duration");
      expect(state.labour_plan).toBeNull();
    });
  });

  describe("resolvePricingMode returns null when unset", () => {
    it("returns null when pricing is null", () => {
      const state = mergeSowDelta(null, delta());

      const mode = resolvePricingMode(state);
      expect(mode).toBeNull();
    });

    it("returns the explicit mode when pricing is set", () => {
      const fixed = mergeSowDelta(
        null,
        delta({ pricing: { mode: "fixed", fixed_amount: 2000 } }),
      );
      expect(resolvePricingMode(fixed)).toBe("fixed");

      const days = mergeSowDelta(
        null,
        delta({ pricing: { mode: "days", fixed_amount: null } }),
      );
      expect(resolvePricingMode(days)).toBe("days");

      const calculated = mergeSowDelta(
        null,
        delta({ pricing: { mode: "calculated", fixed_amount: null } }),
      );
      expect(resolvePricingMode(calculated)).toBe("calculated");
    });
  });

  describe("applyPricingMode handles null mode (legacy jobs)", () => {
    const crewLine: LineItem = {
      description: "Labour",
      category: "labour",
      quantity: 4,
      unit: "day",
      unit_price: 0,
      multiplier: 1,
      people_count: 2,
      overtime: false,
      assumed: false,
      people: [
        { label: "Owner", days: 4, day_rate: 340 },
        { label: "Labourer", days: 4, day_rate: 120 },
      ],
    };

    it("produces the calculated breakdown when mode is null (legacy fallback)", () => {
      // Legacy job where pricing was never set
      const sow = {
        job_type: "electrical",
        pricing: null,
      };

      const active = applyPricingMode([crewLine], sow);

      // Should return the calculated breakdown unchanged (same as "calculated" mode)
      expect(active).toEqual([crewLine]);
    });

    it("keeps provisional sums when mode is null", () => {
      const provisional: LineItem = {
        description: "Consumer unit upgrade (condition unknown)",
        category: "other",
        quantity: 1,
        unit: "sum",
        unit_price: 450,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: true,
        provisional: true,
      };

      const sow = {
        job_type: "electrical",
        pricing: null,
      };

      const active = applyPricingMode([crewLine, provisional], sow);

      // Should keep all line items
      expect(active).toHaveLength(2);
      expect(active[0]).toBe(crewLine);
      expect(active[1]).toBe(provisional);
    });
  });

  describe("Integration: incidental duration mention flow", () => {
    it("captures duration but continues to ask for pricing mode", () => {
      // Turn 1: Incidental duration mention
      const afterDurationMention = mergeSowDelta(
        null,
        delta({
          job_type: "rewiring",
          labour_plan: { people_count: null, duration_days: 4, crew_description: null },
        }),
      );

      // Slot is NOT satisfied
      expect(getUnansweredChecklistQuestions(afterDurationMention)).toContain("duration");

      // Turn 2: User answers pricing mode question
      const afterPricingAnswer = mergeSowDelta(
        afterDurationMention,
        delta({
          pricing: { mode: "days", fixed_amount: null },
        }),
      );

      // NOW the slot is satisfied
      expect(getUnansweredChecklistQuestions(afterPricingAnswer)).not.toContain("duration");

      // Both duration and mode are captured
      expect(afterPricingAnswer.labour_plan?.duration_days).toBe(4);
      expect(afterPricingAnswer.pricing?.mode).toBe("days");
    });
  });
});
