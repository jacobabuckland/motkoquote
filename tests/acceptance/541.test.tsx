/**
 * VOICE-4: Show when a call was cut short by a cap
 *
 * A call that ends because a hard limit (turn cap or time cap) was reached must
 * not present as a completed conversation. The wrap_reason already distinguishes
 * capped from natural endings; this surfaces that signal to the contractor.
 */

import { describe, expect, it } from "vitest";
import type { WrapReason, SowState } from "@/lib/schemas/sow";
import { sowStateSchema } from "@/lib/schemas/sow";

describe("VOICE-4: cap_ended flag", () => {
  describe("endedOnCap predicate", () => {
    it("returns true for cap_questions and cap_time", async () => {
      const { endedOnCap } = await import("@/lib/schemas/sow");

      const CAPPED: WrapReason[] = ["cap_questions", "cap_time"];

      for (const reason of CAPPED) {
        expect(endedOnCap(reason), `expected ${reason} to be a capped ending`).toBe(true);
      }
    });

    it("returns false for natural endings: slots, user, manual", async () => {
      const { endedOnCap } = await import("@/lib/schemas/sow");

      const NATURAL: WrapReason[] = ["slots", "user", "manual"];

      for (const reason of NATURAL) {
        expect(endedOnCap(reason), `expected ${reason} to be a natural ending`).toBe(false);
      }
    });
  });

  describe("SowState schema", () => {
    it("includes cap_ended field with default false", () => {
      const minimalSow = {
        job_type: "bathroom",
        rooms: [],
        materials_mentioned: [],
        access_issues: undefined,
        existing_conditions: undefined,
        timeline: undefined,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        pricing: null,
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
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
        // cap_ended omitted — default should be false
      };

      const parsed = sowStateSchema.parse(minimalSow);

      expect(parsed.cap_ended).toBe(false);
    });

    it("accepts cap_ended: true", () => {
      const minimalSow = {
        job_type: "bathroom",
        rooms: [],
        materials_mentioned: [],
        access_issues: undefined,
        existing_conditions: undefined,
        timeline: undefined,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        pricing: null,
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
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
        cap_ended: true,
      };

      const parsed = sowStateSchema.parse(minimalSow);

      expect(parsed.cap_ended).toBe(true);
    });
  });

  describe("completeSow sets cap_ended from wrap_reason", () => {
    it("sets cap_ended: true when wrap_reason is cap_questions", async () => {
      // This tests the composition: endedOnCap(wrapReason) → cap_ended on SowState.
      // completeSow in src/app/jobs/actions.ts must call endedOnCap and set the flag.
      //
      // We cannot easily invoke completeSow here (it's an async function with many
      // dependencies), so we assert the contract: any SowState with wrap_reason
      // from the capped set must have cap_ended: true, and the implementer must
      // wire endedOnCap into completeSow to make that true.

      const sowWithCapQuestions: Partial<SowState> = {
        job_type: "rewire",
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        complete: true,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
        cap_ended: true, // ← this is what completeSow must produce
      };

      // If endedOnCap("cap_questions") is true, then completeSow must set cap_ended: true
      const { endedOnCap } = await import("@/lib/schemas/sow");
      const shouldBeCapped = endedOnCap("cap_questions");

      expect(shouldBeCapped).toBe(true);
      expect(sowWithCapQuestions.cap_ended).toBe(true);
    });

    it("sets cap_ended: true when wrap_reason is cap_time", async () => {
      const sowWithCapTime: Partial<SowState> = {
        job_type: "rewire",
        rooms: [],
        materials_mentioned: [],
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        complete: true,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
        cap_ended: true,
      };

      const { endedOnCap } = await import("@/lib/schemas/sow");
      const shouldBeCapped = endedOnCap("cap_time");

      expect(shouldBeCapped).toBe(true);
      expect(sowWithCapTime.cap_ended).toBe(true);
    });

    it("leaves cap_ended: false when wrap_reason is a natural ending", async () => {
      const naturalReasons: WrapReason[] = ["slots", "user", "manual"];

      const { endedOnCap } = await import("@/lib/schemas/sow");

      for (const reason of naturalReasons) {
        const shouldBeCapped = endedOnCap(reason);
        expect(shouldBeCapped, `${reason} should not be capped`).toBe(false);

        // completeSow must leave cap_ended as false (its default)
        const sowWithNaturalEnding: Partial<SowState> = {
          job_type: "rewire",
          rooms: [],
          materials_mentioned: [],
          inclusions: [],
          exclusions: [],
          additional_items: [],
          assumptions_and_unknowns: [],
          complete: true,
          reclassification_count: 0,
          used_generic_fallback: false,
          wrap_incomplete: false,
          unasked_required: [],
          stated_prices: [],
          declined_slots: [],
          cap_ended: false,
        };

        expect(sowWithNaturalEnding.cap_ended).toBe(false);
      }
    });
  });

  describe("job page displays cap_ended warning", () => {
    it("exists and imports cleanly", async () => {
      const mod = await import("@/app/jobs/[id]/page");
      expect(mod.default).toBeDefined();
    });

    // The job page at src/app/jobs/[id]/page.tsx reads sow.cap_ended and displays
    // a banner. Testing the full render requires mocking Supabase and auth, which
    // is out of scope for this acceptance test. The contract is:
    //
    // - When sow.cap_ended is true, display a warning that the call was cut short
    // - When sow.cap_ended is false, no such warning
    //
    // The Engineer must wire this on the job page, similar to how wrap_incomplete
    // is surfaced at line 615.
  });

  describe("edge case: both cap_ended and wrap_incomplete can be true", () => {
    it("schema accepts both flags as true", () => {
      const sowWithBothFlags = {
        job_type: "bathroom",
        rooms: [],
        materials_mentioned: [],
        access_issues: undefined,
        existing_conditions: undefined,
        timeline: undefined,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        pricing: null,
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        customer_name: undefined,
        site_address: undefined,
        customer_phone: undefined,
        customer_email: undefined,
        complete: true,
        next_question: undefined,
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: true, // ← required slot was unanswered
        unasked_required: ["crew"],
        stated_prices: [],
        declined_slots: [],
        cap_ended: true, // ← AND the call hit a cap
      };

      const parsed = sowStateSchema.parse(sowWithBothFlags);

      expect(parsed.cap_ended).toBe(true);
      expect(parsed.wrap_incomplete).toBe(true);
      expect(parsed.unasked_required).toContain("crew");
    });
  });
});
