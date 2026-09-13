import { describe, expect, it } from "vitest";
import type { MaterialsSupply } from "@/lib/schemas/job";
import {
  CHECKLIST_QUESTION_IDS,
  CHECKLIST_QUESTIONS,
  CHECKLIST_SLOT_LABELS,
  EMPTY_SOW_STATE,
  REQUIRED_CHECKLIST_QUESTIONS,
  SOW_DELTA_TOOL_PARAMETERS,
  getUnansweredChecklistQuestions,
  mergeSowDelta,
  type ChecklistQuestionId,
  type SowState,
} from "@/lib/schemas/sow";

describe("customer_name is a first-class checklist slot", () => {
  it("appears in CHECKLIST_QUESTION_IDS", () => {
    expect(CHECKLIST_QUESTION_IDS).toContain("customer_name");
  });

  it("appears in REQUIRED_CHECKLIST_QUESTIONS", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("customer_name");
  });

  it("has a question in CHECKLIST_QUESTIONS", () => {
    expect(CHECKLIST_QUESTIONS).toHaveProperty("customer_name");
    expect(typeof CHECKLIST_QUESTIONS.customer_name).toBe("string");
    expect(CHECKLIST_QUESTIONS.customer_name.length).toBeGreaterThan(0);
  });

  it("has a label in CHECKLIST_SLOT_LABELS", () => {
    expect(CHECKLIST_SLOT_LABELS).toHaveProperty("customer_name");
    expect(typeof CHECKLIST_SLOT_LABELS.customer_name).toBe("string");
    expect(CHECKLIST_SLOT_LABELS.customer_name.length).toBeGreaterThan(0);
  });

  it("is returned by getUnansweredChecklistQuestions when customer_name is null", () => {
    const sow: SowState = { ...EMPTY_SOW_STATE, customer_name: null };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("customer_name");
  });

  it("is returned when customer_name is undefined", () => {
    const sow: SowState = { ...EMPTY_SOW_STATE, customer_name: undefined };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("customer_name");
  });

  it("is returned when customer_name is empty string", () => {
    const sow: SowState = { ...EMPTY_SOW_STATE, customer_name: "" };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("customer_name");
  });

  it("is returned when customer_name is whitespace-only", () => {
    const sow: SowState = { ...EMPTY_SOW_STATE, customer_name: "   " };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("customer_name");
  });

  it("is NOT returned when customer_name is a non-empty string", () => {
    const sow: SowState = { ...EMPTY_SOW_STATE, customer_name: "Mrs Okafor" };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).not.toContain("customer_name");
  });

  it("blocks a wrap when every other required slot is filled but customer_name is missing", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      customer_name: undefined,
      labour_plan: {
        people_count: 2,
        duration_days: 3,
        crew_description: "me and a labourer",
        working_dates: "Monday through Wednesday",
      },
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "about twenty metres of cable",
        materials_detail: "twin and earth",
      },
      pricing: { mode: "days", fixed_amount: null },
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        notes: undefined,
        nothing_agreed: true,
      },
    };

    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("customer_name");
  });
});

describe("materials supply schema accepts the new fields", () => {
  it("accepts quantity_guidance as an optional string", async () => {
    const mod = await import("@/lib/schemas/job");
    const parsed = mod.materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "about fifteen metres of cable",
    });
    expect(parsed.quantity_guidance).toBe("about fifteen metres of cable");
  });

  it("accepts materials_detail as an optional string", async () => {
    const mod = await import("@/lib/schemas/job");
    const parsed = mod.materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      materials_detail: "twin and earth, 2.5mm",
    });
    expect(parsed.materials_detail).toBe("twin and earth, 2.5mm");
  });

  it("accepts both new fields together", async () => {
    const mod = await import("@/lib/schemas/job");
    const parsed = mod.materialsSupplySchema.parse({
      contractor_supplied: [],
      customer_supplied: [],
      responsibility: "contractor",
      quantity_guidance: "twelve sheets",
      materials_detail: "12.5mm tapered edge plasterboard",
    });
    expect(parsed.quantity_guidance).toBe("twelve sheets");
    expect(parsed.materials_detail).toBe("12.5mm tapered edge plasterboard");
  });

  it("parses old rows without the new fields unchanged", async () => {
    const mod = await import("@/lib/schemas/job");
    const oldRow: MaterialsSupply = {
      contractor_supplied: ["cable", "sockets"],
      customer_supplied: [],
      responsibility: "contractor",
    };
    const parsed = mod.materialsSupplySchema.parse(oldRow);
    expect(parsed.contractor_supplied).toEqual(["cable", "sockets"]);
    expect(parsed.responsibility).toBe("contractor");
    expect(parsed.quantity_guidance).toBeUndefined();
    expect(parsed.materials_detail).toBeUndefined();
  });
});

describe("materials supply answered check requires the new fields", () => {
  it("reports materials_supply unanswered when only responsibility is set", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("materials_supply");
  });

  it("considers materials_supply answered when responsibility and quantity_guidance are set", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "you work it out",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).not.toContain("materials_supply");
  });

  it("considers materials_supply answered when responsibility and materials_detail are set", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        materials_detail: "standard domestics, nothing fancy",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).not.toContain("materials_supply");
  });

  it("considers materials_supply answered when all three parts are present", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: ["cable"],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "about twenty metres",
        materials_detail: "twin and earth, 2.5mm",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).not.toContain("materials_supply");
  });

  it("treats whitespace-only quantity_guidance as absent", () => {
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

  it("treats whitespace-only materials_detail as absent", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        materials_detail: "   ",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("materials_supply");
  });

  it("treats empty string quantity_guidance as absent", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "",
      },
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toContain("materials_supply");
  });
});

describe("materials supply question asks for all three parts", () => {
  it("mentions who supplies the materials", () => {
    const question = CHECKLIST_QUESTIONS.materials_supply;
    expect(question.toLowerCase()).toMatch(/who|supplies/);
  });

  it("mentions how much is needed", () => {
    const question = CHECKLIST_QUESTIONS.materials_supply;
    expect(question.toLowerCase()).toMatch(/how much|quantity|roughly/);
  });

  it("mentions what specifically", () => {
    const question = CHECKLIST_QUESTIONS.materials_supply;
    expect(question.toLowerCase()).toMatch(/what|specifically|which/);
  });
});

describe("SOW_DELTA_TOOL_PARAMETERS documents the new fields", () => {
  it("materials_supply.properties includes quantity_guidance", () => {
    const props = SOW_DELTA_TOOL_PARAMETERS.properties.materials_supply?.properties;
    expect(props).toHaveProperty("quantity_guidance");
    expect(props?.quantity_guidance).toHaveProperty("type", "string");
    expect(props?.quantity_guidance).toHaveProperty("description");
  });

  it("materials_supply.properties includes materials_detail", () => {
    const props = SOW_DELTA_TOOL_PARAMETERS.properties.materials_supply?.properties;
    expect(props).toHaveProperty("materials_detail");
    expect(props?.materials_detail).toHaveProperty("type", "string");
    expect(props?.materials_detail).toHaveProperty("description");
  });

  it("quantity_guidance description mentions 'you work it out' as a valid answer", () => {
    const props = SOW_DELTA_TOOL_PARAMETERS.properties.materials_supply?.properties;
    const desc = props?.quantity_guidance?.description ?? "";
    expect(desc.toLowerCase()).toMatch(/you work it out|work it out|deferred/);
  });
});

describe("mergeSowDelta handles the new materials_supply fields", () => {
  it("merges quantity_guidance with last-value-wins", () => {
    const base: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "ten metres",
      },
    };

    const merged = mergeSowDelta(base, {
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        quantity_guidance: "fifteen metres",
      },
    });

    expect(merged.materials_supply?.quantity_guidance).toBe("fifteen metres");
  });

  it("merges materials_detail with last-value-wins", () => {
    const base: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        materials_detail: "twin and earth",
      },
    };

    const merged = mergeSowDelta(base, {
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        materials_detail: "three core and earth",
      },
    });

    expect(merged.materials_supply?.materials_detail).toBe("three core and earth");
  });

  it("preserves quantity_guidance when delta omits it", () => {
    const base: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "ten metres",
      },
    };

    const merged = mergeSowDelta(base, {
      materials_supply: {
        contractor_supplied: ["cable"],
        customer_supplied: [],
      },
    });

    expect(merged.materials_supply?.quantity_guidance).toBe("ten metres");
  });

  it("preserves materials_detail when delta omits it", () => {
    const base: SowState = {
      ...EMPTY_SOW_STATE,
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        materials_detail: "twin and earth",
      },
    };

    const merged = mergeSowDelta(base, {
      materials_supply: {
        contractor_supplied: ["cable"],
        customer_supplied: [],
      },
    });

    expect(merged.materials_supply?.materials_detail).toBe("twin and earth");
  });
});

describe("customer_name is NOT filtered by declined_slots", () => {
  it("does not return customer_name when it is in declined_slots", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      customer_name: undefined,
      declined_slots: ["customer_name" as ChecklistQuestionId],
    };
    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).not.toContain("customer_name");
  });
});

describe("a fully-answered SoW under the new rules", () => {
  it("reports nothing unanswered when customer_name and materials details are present", () => {
    const sow: SowState = {
      ...EMPTY_SOW_STATE,
      customer_name: "Mrs Okafor",
      labour_plan: {
        people_count: 2,
        duration_days: 3,
        crew_description: "me and a labourer",
        working_dates: "Monday through Wednesday",
      },
      materials_supply: {
        contractor_supplied: [],
        customer_supplied: [],
        responsibility: "contractor",
        quantity_guidance: "about twenty metres",
        materials_detail: "twin and earth",
      },
      pricing: { mode: "days", fixed_amount: null },
      deadline: { quote_by: undefined, job_by: "end of month" },
      agreed_costs: {
        day_rate: null,
        fixed_price: null,
        deposit_amount: null,
        notes: undefined,
        nothing_agreed: true,
      },
    };

    const unanswered = getUnansweredChecklistQuestions(sow);
    expect(unanswered).toEqual([]);
  });
});
