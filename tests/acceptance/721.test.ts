import { describe, expect, it } from "vitest";
import type { ChecklistQuestionId, SowState } from "@/lib/schemas/sow";

describe("Issue #721: Motko must ask who the quote is for, and the full materials question", () => {
  describe("customer_name is a first-class checklist slot", () => {
    it("appears in CHECKLIST_QUESTION_IDS", async () => {
      const { CHECKLIST_QUESTION_IDS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_QUESTION_IDS).toContain("customer_name");
    });

    it("appears in REQUIRED_CHECKLIST_QUESTIONS", async () => {
      const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("customer_name");
    });

    it("has a question in CHECKLIST_QUESTIONS", async () => {
      const { CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_QUESTIONS.customer_name).toBeDefined();
      expect(typeof CHECKLIST_QUESTIONS.customer_name).toBe("string");
      expect(CHECKLIST_QUESTIONS.customer_name.length).toBeGreaterThan(0);
    });

    it("has a label in CHECKLIST_SLOT_LABELS", async () => {
      const { CHECKLIST_SLOT_LABELS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_SLOT_LABELS.customer_name).toBeDefined();
      expect(typeof CHECKLIST_SLOT_LABELS.customer_name).toBe("string");
      expect(CHECKLIST_SLOT_LABELS.customer_name.length).toBeGreaterThan(0);
      expect(CHECKLIST_SLOT_LABELS.customer_name.length).toBeLessThan(50);
    });
  });

  describe("customer_name answeredness checks", () => {
    it("returns customer_name as unanswered when missing", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("treats empty string as unanswered", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("treats whitespace-only string as unanswered", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "   ",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("considers customer_name answered when a name is present", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Mrs Okafor",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("customer_name");
    });

    it("includes customer_name in required unanswered list when other required slots satisfied", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        labour_plan: {
          crew_description: "just me",
          people_count: 1,
          duration_days: 2,
          working_dates: "next Tuesday",
        },
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: "I'll work it out",
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
        pricing: { mode: "days", fixed_amount: null },
        deadline: { quote_by: undefined, job_by: "end of month" },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toEqual(["customer_name"]);
    });

    it("does NOT return customer_name when declined", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        declined_slots: ["customer_name"],
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("customer_name");
    });
  });

  describe("materials_supply schema widened with quantity_guidance", () => {
    it("accepts a quantity_guidance field", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "about twenty sockets worth",
      });

      expect(parsed.quantity_guidance).toBe("about twenty sockets worth");
    });

    it("accepts 'you work it out' as a valid quantity_guidance value", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "you work it out",
      });

      expect(parsed.quantity_guidance).toBe("you work it out");
    });

    it("allows quantity_guidance to be undefined", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
      });

      expect(parsed.quantity_guidance).toBeUndefined();
    });

    it("transforms null quantity_guidance to undefined (nullishString behavior)", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: null,
      });

      expect(parsed.quantity_guidance).toBeUndefined();
    });
  });

  describe("materials_supply answeredness requires both responsibility and quantity_guidance", () => {
    it("considers materials_supply unanswered when only responsibility is set", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: undefined,
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("materials_supply");
    });

    it("considers materials_supply unanswered when only quantity_guidance is set", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: undefined,
          quantity_guidance: "about fifty metres of cable",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("materials_supply");
    });

    it("considers materials_supply answered when both responsibility and quantity_guidance are set", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: "I'll work it out",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("materials_supply");
    });

    it("treats whitespace-only quantity_guidance as unanswered", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: "   ",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("materials_supply");
    });

    it("works with split responsibility and specific guidance", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          contractor_supplied: ["cable", "sockets"],
          customer_supplied: ["light fittings"],
          responsibility: "split",
          quantity_guidance: "about thirty sockets and six lights",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("materials_supply");
    });
  });

  describe("integration: all required slots including customer_name and widened materials", () => {
    it("returns empty when all required slots satisfied", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        labour_plan: {
          crew_description: "me and Billy",
          people_count: 2,
          duration_days: 3,
          working_dates: "starting Monday the 16th",
        },
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: "standard kitchen rewire quantities",
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
        pricing: { mode: "days", fixed_amount: null },
        deadline: { quote_by: undefined, job_by: undefined },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toEqual([]);
    });

    it("returns both customer_name and materials_supply when both missing", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        labour_plan: {
          crew_description: "just me",
          people_count: 1,
          duration_days: 2,
          working_dates: "next week",
        },
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: undefined,
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
        pricing: { mode: "calculated", fixed_amount: null },
        deadline: { quote_by: undefined, job_by: undefined },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
      expect(unanswered).toContain("materials_supply");
    });
  });

  describe("summarizeRequiredSlotCoverage reflects the widened required list", () => {
    it("counts customer_name in the asked/answered tallies", async () => {
      const { summarizeRequiredSlotCoverage, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Bob Jones",
        labour_plan: {
          crew_description: "just me",
          people_count: 1,
          duration_days: 2,
          working_dates: "Tuesday and Wednesday",
        },
        materials_supply: {
          contractor_supplied: [],
          customer_supplied: [],
          responsibility: "contractor",
          quantity_guidance: "I'll work it out",
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
        pricing: { mode: "days", fixed_amount: null },
        deadline: { quote_by: undefined, job_by: undefined },
      };

      // All seven required slots asked (crew, duration, materials_supply, working_dates, deadline, agreed_costs, customer_name)
      const asked: ChecklistQuestionId[] = ["crew", "duration", "materials_supply", "working_dates", "deadline", "agreed_costs", "customer_name"];
      const summary = summarizeRequiredSlotCoverage(sow, asked);

      expect(summary.asked).toBe(7);
      expect(summary.answered).toBe(6); // all except deadline (job_by is undefined)
      expect(summary.unknown).toBe(1);
    });
  });
});
