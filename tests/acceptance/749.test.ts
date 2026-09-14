/**
 * Motko must ask who the quote is for, and the full materials question.
 *
 * Two intake failures reported from live calls on 12 Sep:
 *
 * 1. Customer name was missing — not because the call ended early, but because
 *    Motko never asked. The name was prompt instruction only, with no record of
 *    whether it was actually put to the contractor.
 *
 * 2. Materials question incomplete — asking only WHO supplies materials, not
 *    HOW MUCH or WHAT SPECIFICALLY. A contractor could answer "I'm supplying it"
 *    and the slot read as complete.
 *
 * Per Jacob's ruling (14 Sep): customer_name must NOT enter
 * REQUIRED_CHECKLIST_QUESTIONS. A call may wrap without it; the absence is
 * surfaced to the contractor, never held as a gate.
 */

import { describe, expect, it } from "vitest";
import type { SowState } from "@/lib/schemas/sow";
import type { MaterialsSupply } from "@/lib/schemas/job";

describe("Customer name tracking", () => {
  it("customer_name does NOT appear in REQUIRED_CHECKLIST_QUESTIONS", async () => {
    const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

    // Per Jacob's ruling (14 Sep) and tests/acceptance/373.test.tsx:222 —
    // customer details never become required checklist questions
    const asString = REQUIRED_CHECKLIST_QUESTIONS.join(",");
    expect(asString).not.toContain("customer");
    expect(asString).not.toContain("name");
    expect(asString).not.toContain("contact");
  });

  it("customer_name is in UNASKED_REQUIRED_IDS for reporting purposes", async () => {
    const { UNASKED_REQUIRED_IDS } = await import("@/lib/schemas/sow");

    // UNASKED_REQUIRED_IDS is deliberately wider than the checklist — it includes
    // customer_name, customer_contact, and site_address for reporting to the job
    // page, but NOT for gating the wrap
    expect(UNASKED_REQUIRED_IDS).toContain("customer_name");
  });

  it("CUSTOMER_NAME_QUESTION is defined", async () => {
    const { CUSTOMER_NAME_QUESTION } = await import("@/lib/schemas/sow");

    expect(CUSTOMER_NAME_QUESTION).toBeDefined();
    expect(typeof CUSTOMER_NAME_QUESTION).toBe("string");
    expect(CUSTOMER_NAME_QUESTION.length).toBeGreaterThan(0);
  });

  it("getMissingCustomerDetails detects missing customer_name", async () => {
    const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    // No name — should be in missing list
    const noName = getMissingCustomerDetails({
      ...EMPTY_SOW_STATE,
      customer_name: undefined,
      customer_phone: "07700 900123",
      customer_email: undefined,
    });
    expect(noName).toContain("customer_name");

    // Name provided — should NOT be in missing list
    const withName = getMissingCustomerDetails({
      ...EMPTY_SOW_STATE,
      customer_name: "Mrs Okafor",
      customer_phone: "07700 900123",
      customer_email: undefined,
    });
    expect(withName).not.toContain("customer_name");
  });

  it("getMissingCustomerDetails treats empty string as missing", async () => {
    const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    const emptyString = getMissingCustomerDetails({
      ...EMPTY_SOW_STATE,
      customer_name: "",
      customer_phone: "07700 900123",
      customer_email: undefined,
    });
    expect(emptyString).toContain("customer_name");
  });

  it("getMissingCustomerDetails treats whitespace-only as missing", async () => {
    const { getMissingCustomerDetails, EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    const whitespace = getMissingCustomerDetails({
      ...EMPTY_SOW_STATE,
      customer_name: "   ",
      customer_phone: "07700 900123",
      customer_email: undefined,
    });
    expect(whitespace).toContain("customer_name");
  });
});

describe("Materials schema gains quantity_guidance", () => {
  it("materialsSupplySchema includes quantity_guidance field", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    // Parse a complete materials object with the new field
    const complete = materialsSupplySchema.parse({
      contractor_supplied: ["plaster"],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "about 40 square metres",
    });

    expect(complete.quantity_guidance).toBe("about 40 square metres");
  });

  it("quantity_guidance accepts 'you work it out' as a valid answer", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    const delegated = materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "you work it out",
    });

    expect(delegated.quantity_guidance).toBe("you work it out");
  });

  it("quantity_guidance can be undefined (not yet asked)", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    const noQuantity = materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: undefined,
    });

    expect(noQuantity.quantity_guidance).toBeUndefined();
  });

  it("quantity_guidance transforms null to undefined", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    // nullishString pattern: null parses and transforms to undefined
    const nullValue = materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: null,
    });

    expect(nullValue.quantity_guidance).toBeUndefined();
  });

  it("empty string for quantity_guidance is preserved as empty string", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    const emptyString = materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "",
    });

    // Empty string is treated as missing by the answeredness check, but the
    // schema doesn't transform it
    expect(emptyString.quantity_guidance).toBe("");
  });
});

describe("Materials answeredness requires all three parts", () => {
  it("considers materials_supply unanswered when only responsibility is set", async () => {
    const { getUnansweredRequiredChecklistQuestions, mergeSowDelta } =
      await import("@/lib/schemas/sow");

    // Only responsibility, no quantity_guidance — this used to read as "answered"
    const state = mergeSowDelta(null, {
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: undefined,
      },
    });

    const unanswered = getUnansweredRequiredChecklistQuestions(state);
    expect(unanswered).toContain("materials_supply");
  });

  it("considers materials_supply unanswered when only quantity_guidance is set", async () => {
    const { getUnansweredRequiredChecklistQuestions, mergeSowDelta } =
      await import("@/lib/schemas/sow");

    // Only quantity, no responsibility
    const state = mergeSowDelta(null, {
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: undefined,
        quantity_guidance: "about 40 square metres",
      },
    });

    const unanswered = getUnansweredRequiredChecklistQuestions(state);
    expect(unanswered).toContain("materials_supply");
  });

  it("considers materials_supply answered when responsibility and quantity_guidance are both set", async () => {
    const { getUnansweredRequiredChecklistQuestions, mergeSowDelta } =
      await import("@/lib/schemas/sow");

    // Both responsibility and quantity_guidance present
    const state = mergeSowDelta(null, {
      labour_plan: {
        people_count: 1,
        duration_days: 2,
        crew_description: "just me",
        working_dates: "Monday and Tuesday",
      },
      pricing: { mode: "calculated", fixed_amount: null },
      materials_supply: {
        contractor_supplied: ["plaster"],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "about 40 square metres",
      },
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        nothing_agreed: true,
      },
    });

    const unanswered = getUnansweredRequiredChecklistQuestions(state);
    expect(unanswered).not.toContain("materials_supply");
  });

  it("considers materials_supply answered when quantity_guidance is 'you work it out'", async () => {
    const { getUnansweredRequiredChecklistQuestions, mergeSowDelta } =
      await import("@/lib/schemas/sow");

    // "you work it out" is a complete answer for quantity
    const state = mergeSowDelta(null, {
      labour_plan: {
        people_count: 1,
        duration_days: 2,
        crew_description: "just me",
        working_dates: "Monday and Tuesday",
      },
      pricing: { mode: "calculated", fixed_amount: null },
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "you work it out",
      },
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        nothing_agreed: true,
      },
    });

    const unanswered = getUnansweredRequiredChecklistQuestions(state);
    expect(unanswered).not.toContain("materials_supply");
  });

  it("legacy rows without quantity_guidance remain valid", async () => {
    const { materialsSupplySchema } = await import("@/lib/schemas/job");

    // Legacy row — no quantity_guidance field at all
    const legacy = materialsSupplySchema.parse({
      contractor_supplied: ["plaster"],
      customer_supplied: [],
      responsibility: "contractor",
    });

    expect(legacy.quantity_guidance).toBeUndefined();
  });

  it("legacy rows are considered answered using old logic", async () => {
    const { getUnansweredRequiredChecklistQuestions, mergeSowDelta } =
      await import("@/lib/schemas/sow");

    // Legacy row shape: responsibility set, no quantity_guidance field
    // For backward compatibility, these should be considered answered
    const legacyState = mergeSowDelta(null, {
      labour_plan: {
        people_count: 1,
        duration_days: 2,
        crew_description: "just me",
        working_dates: "Monday and Tuesday",
      },
      pricing: { mode: "calculated", fixed_amount: null },
      materials_supply: {
        contractor_supplied: ["plaster"],
        customer_supplied: [],
        responsibility: "contractor",
        // quantity_guidance deliberately omitted — legacy shape
      },
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        nothing_agreed: true,
      },
    });

    // The answeredness check should handle legacy rows gracefully
    const unanswered = getUnansweredRequiredChecklistQuestions(legacyState);

    // Legacy rows with responsibility set should be considered answered,
    // OR the check should be backward compatible
    // This assertion will fail-first and guide the implementation
    const hasMaterials = !unanswered.includes("materials_supply");
    expect(hasMaterials).toBe(true);
  });
});

describe("Materials question asks all three parts", () => {
  it("CHECKLIST_QUESTIONS materials_supply asks for quantity", async () => {
    const { CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

    const question = CHECKLIST_QUESTIONS.materials_supply;

    // The question should ask about quantity/how much, not just who supplies
    const lowerQuestion = question.toLowerCase();
    expect(
      lowerQuestion.includes("how much") ||
      lowerQuestion.includes("quantity") ||
      lowerQuestion.includes("roughly") ||
      lowerQuestion.includes("work it out")
    ).toBe(true);
  });

  it("CHECKLIST_QUESTIONS materials_supply still asks who supplies", async () => {
    const { CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

    const question = CHECKLIST_QUESTIONS.materials_supply;

    // Should still ask WHO supplies (the original question)
    const lowerQuestion = question.toLowerCase();
    expect(
      lowerQuestion.includes("who") || lowerQuestion.includes("you, or") || lowerQuestion.includes("customer")
    ).toBe(true);
  });
});

describe("Type safety — customer_name is string | undefined, never null", () => {
  it("SowState accepts customer_name as undefined", async () => {
    const { EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    const withUndefined: SowState = {
      ...EMPTY_SOW_STATE,
      customer_name: undefined,
    };

    expect(withUndefined.customer_name).toBeUndefined();
  });

  it("SowState accepts customer_name as string", async () => {
    const { EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    const withName: SowState = {
      ...EMPTY_SOW_STATE,
      customer_name: "Mrs Okafor",
    };

    expect(withName.customer_name).toBe("Mrs Okafor");
  });

  it("MaterialsSupply accepts quantity_guidance as undefined", async () => {
    const complete: MaterialsSupply = {
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: undefined,
    };

    expect(complete.quantity_guidance).toBeUndefined();
  });

  it("MaterialsSupply accepts quantity_guidance as string", async () => {
    const complete: MaterialsSupply = {
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "about 40 square metres",
    };

    expect(complete.quantity_guidance).toBe("about 40 square metres");
  });
});

describe("Constraints from frozen tests must be preserved", () => {
  it("deadline is NOT in REQUIRED_CHECKLIST_QUESTIONS", async () => {
    const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

    // tests/regression/agreed-costs-is-asked.test.ts:72 pins deadline out
    // Do NOT add deadline to required as part of this change
    expect(REQUIRED_CHECKLIST_QUESTIONS).not.toContain("deadline");
  });

  it("REQUIRED_CHECKLIST_QUESTIONS has exactly 5 items", async () => {
    const { REQUIRED_CHECKLIST_QUESTIONS } = await import("@/lib/schemas/sow");

    // The frozen count from before this change: crew, duration, materials_supply,
    // working_dates, agreed_costs
    expect(REQUIRED_CHECKLIST_QUESTIONS).toHaveLength(5);
  });

  it("getUnansweredRequiredChecklistQuestions signature is unchanged", async () => {
    const { getUnansweredRequiredChecklistQuestions, EMPTY_SOW_STATE } =
      await import("@/lib/schemas/sow");

    // Should take a SowState and return ChecklistQuestionId[]
    const result = getUnansweredRequiredChecklistQuestions(EMPTY_SOW_STATE);

    expect(Array.isArray(result)).toBe(true);
    // All items should be valid ChecklistQuestionId values
    const validIds = ["crew", "duration", "materials_supply", "working_dates", "deadline", "agreed_costs"];
    for (const id of result) {
      expect(validIds).toContain(id);
    }
  });
});
