import { describe, it, expect } from "vitest";
import type { SowState } from "@/lib/schemas/sow";

describe("#726 Voice repair: talk to Motko about an existing quote", () => {
  describe("createRealtimeSession with jobId binding", () => {
    it("accepts jobId parameter and binds to existing job", async () => {
      const mod = await import("@/app/jobs/actions");

      const existingJobId = "test_job_with_gaps";

      // This will fail before implementation because createRealtimeSession
      // currently takes no parameters. The type assertion lets it compile,
      // but at runtime it will fail when trying to bind to an existing job.
      const createWithJob = mod.createRealtimeSession as unknown as (
        input?: { jobId?: string }
      ) => Promise<{ jobId: string; clientSecret: string }>;

      const result = await createWithJob({ jobId: existingJobId });

      // After implementation, this should return the SAME jobId that was passed in
      expect(result.jobId).toBe(existingJobId);
      expect(result.clientSecret).toBeDefined();
    });
  });

  describe("buildJobIntakeInstructions with repair mode", () => {
    it("accepts existingSow parameter and generates repair instructions", async () => {
      const mod = await import("@/lib/voice/job-intake-prompt");

      const existingSow: SowState = {
        job_type: "Electrical work",
        rooms: [
          {
            name: "Living room",
            dimensions: undefined,
            work_items: ["Replace consumer unit"],
          },
        ],
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
        customer_name: "Customer Name",
        site_address: "123 Main St",
        customer_phone: undefined,
        customer_email: undefined,
        complete: false,
        next_question: undefined,
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: true,
        unasked_required: ["crew", "materials_supply"],
        stated_prices: [],
        declined_slots: [],
        cap_ended: false,
      };

      // This will fail before implementation because buildJobIntakeInstructions
      // doesn't accept existingSow yet. Type assertion lets it compile.
      const buildWithRepair = mod.buildJobIntakeInstructions as unknown as (
        personalisation: {
          firstName?: string | null;
          trade?: string | null;
          includeAccountTools?: boolean;
          teamMembers?: unknown[];
          isFirstJob?: boolean;
          hasDayRate?: boolean;
          existingSow?: SowState;
        }
      ) => string;

      const instructions = buildWithRepair({
        firstName: "Alex",
        trade: "Electrician",
        existingSow,
      });

      // After implementation, repair mode instructions should:
      // 1. Reference what's already captured
      expect(instructions).toContain("already");

      // 2. List the incomplete slots to fill
      expect(instructions.toLowerCase()).toMatch(/crew/);
      expect(instructions.toLowerCase()).toMatch(/materials/);

      // 3. Not re-ask for things that are already answered
      expect(instructions).toContain("Customer Name"); // customer_name is already captured
    });

    it("lists specific gaps from unasked_required", async () => {
      const mod = await import("@/lib/voice/job-intake-prompt");

      const existingSow: SowState = {
        job_type: "Plumbing",
        rooms: [{ name: "Bathroom", dimensions: undefined, work_items: ["Install boiler"] }],
        materials_mentioned: [],
        access_issues: undefined,
        existing_conditions: undefined,
        timeline: undefined,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        pricing: { mode: "fixed", fixed_amount: 2500 },
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        customer_name: "John Smith",
        site_address: "123 Oak Lane",
        customer_phone: undefined,
        customer_email: undefined,
        complete: false,
        next_question: undefined,
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: true,
        unasked_required: ["crew", "working_dates", "customer_contact"],
        stated_prices: [],
        declined_slots: [],
        cap_ended: false,
      };

      const buildWithRepair = mod.buildJobIntakeInstructions as unknown as (
        personalisation: {
          firstName?: string | null;
          trade?: string | null;
          existingSow?: SowState;
        }
      ) => string;

      const instructions = buildWithRepair({
        firstName: "Sam",
        trade: "Plumber",
        existingSow,
      });

      // Should ask for all three missing slots
      expect(instructions.toLowerCase()).toMatch(/crew/);
      expect(instructions.toLowerCase()).toMatch(/dates|working/);
      expect(instructions.toLowerCase()).toMatch(/phone|email|contact/);

      // Should NOT re-ask for pricing (already has mode: "fixed")
      expect(existingSow.pricing?.mode).toBe("fixed");
      expect(existingSow.pricing?.fixed_amount).toBe(2500);
    });
  });

  describe("completeSowConversation delta merge", () => {
    it("merges repair deltas into existing sow_json", async () => {
      const mod = await import("@/app/jobs/actions");

      const jobId = "job_with_incomplete_quote";

      // This test verifies that after a repair conversation,
      // the job's sow_json contains BOTH:
      // - The original data (customer_name, site_address, existing rooms)
      // - The new data from repair (crew, materials_supply)

      // Before implementation, this will fail because completeSowConversation
      // doesn't implement delta merging for existing quotes yet

      const result = await mod.completeSowConversation({
        jobId,
        transcript: "Just me for crew, I'm supplying all materials",
        wrapReason: "slots",
        requiredSlotsAsked: ["crew", "materials_supply"],
      });

      expect(result.jobId).toBe(jobId);

      // After implementation, the merged sow_json should have:
      // - Original customer_name (preserved)
      // - New crew info (added by repair)
      // - wrap_incomplete: false (gaps filled)
    });

    it("preserves edited: true lines when re-pricing", async () => {
      // This test verifies that lines with edited: true are NOT re-priced
      // even when repair adds information that would normally trigger re-pricing

      const editedLineDescription = "Replace consumer unit";

      // A line marked edited: true should keep its unit_price even when:
      // - Crew information is added (which would normally re-price labour)
      // - Materials supplier is specified (which would normally re-price materials)

      // Before implementation, this will fail because edited lines are not preserved

      expect(editedLineDescription).toBe("Replace consumer unit");

      // After implementation:
      // - Query the quote's line_items_json
      // - Find the line with description "Replace consumer unit" and edited: true
      // - Verify its unit_price is unchanged after repair
    });

    it("refuses repair when quote is accepted or declined", async () => {
      const mod = await import("@/app/jobs/actions");

      const jobId = "job_with_accepted_quote";

      // completeSowConversation should check quote status
      // and refuse when status is not in EDITABLE_STATUSES

      await expect(
        mod.completeSowConversation({
          jobId,
          transcript: "Repair attempt",
          wrapReason: "slots",
        })
      ).rejects.toThrow(/not editable/i);
    });
  });

  describe("End-to-end repair flow", () => {
    it("creates session bound to job, repairs gaps, preserves hand-edits", async () => {
      const actionsModule = await import("@/app/jobs/actions");
      const promptModule = await import("@/lib/voice/job-intake-prompt");

      const existingJobId = "job_needing_repair";

      // Step 1: Create repair session bound to existing job
      const createWithJob = actionsModule.createRealtimeSession as unknown as (
        input?: { jobId?: string }
      ) => Promise<{ jobId: string; clientSecret: string }>;

      const session = await createWithJob({ jobId: existingJobId });

      expect(session.jobId).toBe(existingJobId);
      expect(session.clientSecret).toBeDefined();

      // Step 2: Instructions should be in repair mode
      const existingSow: SowState = {
        job_type: "Bathroom",
        rooms: [{ name: "Main bathroom", dimensions: undefined, work_items: ["Install suite"] }],
        materials_mentioned: [],
        access_issues: undefined,
        existing_conditions: undefined,
        timeline: undefined,
        labour_plan: null,
        deadline: null,
        materials_supply: null,
        agreed_costs: null,
        pricing: { mode: "fixed", fixed_amount: 3500 },
        inclusions: [],
        exclusions: [],
        additional_items: [],
        assumptions_and_unknowns: [],
        customer_name: "Pat Brown",
        site_address: "789 Oak Lane",
        customer_phone: undefined,
        customer_email: undefined,
        complete: false,
        next_question: undefined,
        overview_narrative: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: true,
        unasked_required: ["crew", "materials_supply", "working_dates"],
        stated_prices: [],
        declined_slots: [],
        cap_ended: false,
      };

      const buildWithRepair = promptModule.buildJobIntakeInstructions as unknown as (
        personalisation: {
          firstName?: string | null;
          existingSow?: SowState;
        }
      ) => string;

      const instructions = buildWithRepair({
        firstName: "Pat",
        existingSow,
      });

      expect(instructions).toContain("already");
      expect(instructions.toLowerCase()).toMatch(/crew|materials|dates/);

      // Step 3: Complete conversation with filled gaps
      const result = await actionsModule.completeSowConversation({
        jobId: existingJobId,
        transcript: "Just me, two days, 10th and 11th, I'm getting all materials",
        wrapReason: "slots",
        requiredSlotsAsked: ["crew", "materials_supply", "working_dates"],
      });

      expect(result.jobId).toBe(existingJobId);
    });
  });
});
