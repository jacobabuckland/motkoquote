import { describe, expect, it } from "vitest";
import type { SowState } from "@/lib/schemas/sow";

describe("Issue #721: Motko must ask who the quote is for, and the full materials question", () => {
  describe("customer_name is promoted to a required checklist slot", () => {
    it("appears in CHECKLIST_QUESTION_IDS", async () => {
      const { CHECKLIST_QUESTION_IDS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_QUESTION_IDS).toContain("customer_name");
    });

    it("appears in REQUIRED_CHECKLIST_QUESTIONS", async () => {
      const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("customer_name");
    });

    it("has an entry in CHECKLIST_QUESTIONS", async () => {
      const { CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_QUESTIONS.customer_name).toBeDefined();
      expect(CHECKLIST_QUESTIONS.customer_name).toContain("customer");
    });

    it("has a terse label in CHECKLIST_SLOT_LABELS", async () => {
      const { CHECKLIST_SLOT_LABELS } = await import("@/lib/schemas/sow");

      expect(CHECKLIST_SLOT_LABELS.customer_name).toBeDefined();
      expect(CHECKLIST_SLOT_LABELS.customer_name.length).toBeLessThan(50);
    });

    it("is included in the tool parameters declined_slots enum", async () => {
      const { SOW_DELTA_TOOL_PARAMETERS } = await import("@/lib/schemas/sow");

      const declinedSlotsEnum = SOW_DELTA_TOOL_PARAMETERS.properties.declined_slots?.items?.enum;
      expect(declinedSlotsEnum).toContain("customer_name");
    });

    it("treats customer_name as unanswered when undefined", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("treats customer_name as unanswered when empty string", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("treats customer_name as unanswered when whitespace-only", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "   ",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("treats customer_name as answered when set to a non-empty value", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("customer_name");
    });

    it("reports customer_name as unanswered required when missing", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        labour_plan: {
          people_count: 2,
          duration_days: 3,
          crew_description: "me and a mate",
          working_dates: "Tuesday and Wednesday",
        },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "standard amount",
          materials_detail: undefined,
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
    });

    it("does not report customer_name as unanswered required when present", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        labour_plan: {
          people_count: 2,
          duration_days: 3,
          crew_description: "me and a mate",
          working_dates: "Tuesday and Wednesday",
        },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "standard amount",
          materials_detail: undefined,
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).not.toContain("customer_name");
    });
  });

  describe("materials_supply is widened to three parts", () => {
    it("materialsSupplySchema accepts quantity_guidance field", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        responsibility: "contractor",
        contractor_supplied: [],
        customer_supplied: [],
        quantity_guidance: "you work it out",
      });

      expect(parsed.quantity_guidance).toBe("you work it out");
    });

    it("materialsSupplySchema accepts materials_detail field", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        responsibility: "contractor",
        contractor_supplied: [],
        customer_supplied: [],
        materials_detail: "cable, sockets, consumer unit",
      });

      expect(parsed.materials_detail).toBe("cable, sockets, consumer unit");
    });

    it("parses existing rows without quantity_guidance or materials_detail", async () => {
      const { materialsSupplySchema } = await import("@/lib/schemas/job");

      const parsed = materialsSupplySchema.parse({
        responsibility: "contractor",
        contractor_supplied: [],
        customer_supplied: [],
      });

      expect(parsed.responsibility).toBe("contractor");
      expect(parsed.quantity_guidance).toBeUndefined();
      expect(parsed.materials_detail).toBeUndefined();
    });

    it("considers materials_supply unanswered when only responsibility is set", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
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
          quantity_guidance: "standard amount",
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
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "you work it out",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("materials_supply");
    });

    it("considers materials_supply answered when responsibility, quantity_guidance, and materials_detail are all set", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "standard for a three-bed rewire",
          materials_detail: "cable, sockets, consumer unit",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).not.toContain("materials_supply");
    });

    it("accepts empty string for quantity_guidance as unanswered", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("materials_supply");
    });

    it("accepts whitespace-only quantity_guidance as unanswered", async () => {
      const { getUnansweredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "   ",
        },
      };

      const unanswered = getUnansweredChecklistQuestions(sow);
      expect(unanswered).toContain("materials_supply");
    });

    it("mentions all three parts in the checklist question", async () => {
      const { CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

      const question = CHECKLIST_QUESTIONS.materials_supply;
      // Should mention who supplies, how much, and what
      expect(question.toLowerCase()).toMatch(/who|supplies/);
    });

    it("guides the model to fill all three parts in tool parameters", async () => {
      const { SOW_DELTA_TOOL_PARAMETERS } = await import("@/lib/schemas/sow");

      const materialsDescription = SOW_DELTA_TOOL_PARAMETERS.properties.materials_supply?.description;
      expect(materialsDescription).toBeDefined();
      expect(materialsDescription).toContain("responsibility");
    });
  });

  describe("integration: customer_name and materials_supply together", () => {
    it("reports both as unanswered when both are missing", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toContain("customer_name");
      expect(unanswered).toContain("materials_supply");
    });

    it("reports neither as unanswered when both are fully answered", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        labour_plan: {
          people_count: 2,
          duration_days: 3,
          crew_description: "me and a mate",
          working_dates: "Tuesday and Wednesday",
        },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "standard amount",
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).not.toContain("customer_name");
      expect(unanswered).not.toContain("materials_supply");
    });

    it("a SoW with everything required except customer_name reports one unanswered slot", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: undefined,
        labour_plan: {
          people_count: 2,
          duration_days: 3,
          crew_description: "me and a mate",
          working_dates: "Tuesday and Wednesday",
        },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
          quantity_guidance: "you work it out",
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toHaveLength(1);
      expect(unanswered).toContain("customer_name");
    });

    it("a SoW with everything required except materials quantity reports one unanswered slot", async () => {
      const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

      const sow: SowState = {
        ...EMPTY_SOW_STATE,
        customer_name: "Alice Builder",
        labour_plan: {
          people_count: 2,
          duration_days: 3,
          crew_description: "me and a mate",
          working_dates: "Tuesday and Wednesday",
        },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: {
          responsibility: "contractor",
          contractor_supplied: [],
          customer_supplied: [],
        },
        agreed_costs: {
          day_rate: null,
          fixed_price: null,
          deposit_amount: null,
          notes: undefined,
          nothing_agreed: true,
        },
      };

      const unanswered = getUnansweredRequiredChecklistQuestions(sow);
      expect(unanswered).toHaveLength(1);
      expect(unanswered).toContain("materials_supply");
    });
  });
});
