import { describe, expect, it } from "vitest";
import {
  MAX_JOB_TYPE_RECLASSIFICATIONS,
  mergeSowDelta,
  synthesizeTimeline,
  sowToExtraction,
  getUnansweredChecklistQuestions,
  EMPTY_SOW_STATE,
  type SowDelta,
} from "@/lib/schemas/sow";

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

describe("mergeSowDelta job_type reclassification", () => {
  it("sets job_type on first classification without counting as a reclassification", () => {
    const state = mergeSowDelta(null, delta({ job_type: "plastering" }));
    expect(state.job_type).toBe("plastering");
    expect(state.reclassification_count).toBe(0);
  });

  it("does not count repeating the same job_type (case-insensitive) as a change", () => {
    const first = mergeSowDelta(null, delta({ job_type: "Plastering" }));
    const second = mergeSowDelta(first, delta({ job_type: "plastering" }));
    expect(second.job_type).toBe("plastering");
    expect(second.reclassification_count).toBe(0);
  });

  it("allows one reclassification to a genuinely different job_type", () => {
    const first = mergeSowDelta(null, delta({ job_type: "plastering" }));
    const second = mergeSowDelta(first, delta({ job_type: "rewiring" }));
    expect(second.job_type).toBe("rewiring");
    expect(second.reclassification_count).toBe(1);
  });

  it("ignores further reclassifications once the budget is spent", () => {
    let state = mergeSowDelta(null, delta({ job_type: "plastering" }));
    state = mergeSowDelta(state, delta({ job_type: "rewiring" }));
    expect(state.reclassification_count).toBe(MAX_JOB_TYPE_RECLASSIFICATIONS);

    state = mergeSowDelta(state, delta({ job_type: "plumbing" }));
    expect(state.job_type).toBe("rewiring");
    expect(state.reclassification_count).toBe(1);
  });

  it("carries the job_type forward unchanged when a turn omits it", () => {
    const first = mergeSowDelta(null, delta({ job_type: "plastering" }));
    const second = mergeSowDelta(first, delta());
    expect(second.job_type).toBe("plastering");
    expect(second.reclassification_count).toBe(0);
  });
});

// A1 — the headline bug from the live test call: "fourteen sockets...
// actually it's ten" must actually correct the room's work_items rather
// than accumulating both facts forever.
describe("mergeSowDelta corrections via removed_work_items", () => {
  it("replaces a corrected work item instead of appending alongside the original", () => {
    const first = mergeSowDelta(
      null,
      delta({
        rooms: [
          {
            name: "Downstairs",
            dimensions: undefined,
            work_items: ["fourteen double sockets"],
            removed_work_items: [],
          },
        ],
      }),
    );
    expect(first.rooms[0]?.work_items).toEqual(["fourteen double sockets"]);

    const corrected = mergeSowDelta(
      first,
      delta({
        rooms: [
          {
            name: "Downstairs",
            dimensions: undefined,
            work_items: ["ten double sockets, four in the kitchen excluded"],
            removed_work_items: ["fourteen double sockets"],
          },
        ],
      }),
    );

    expect(corrected.rooms).toHaveLength(1);
    expect(corrected.rooms[0]?.work_items).toEqual([
      "ten double sockets, four in the kitchen excluded",
    ]);
  });

  it("tolerates paraphrased removal wording via fuzzy substring match", () => {
    const first = mergeSowDelta(
      null,
      delta({
        rooms: [
          {
            name: "Kitchen",
            dimensions: undefined,
            work_items: ["rewire kitchen ring main, old rubber cable"],
            removed_work_items: [],
          },
        ],
      }),
    );

    const corrected = mergeSowDelta(
      first,
      delta({
        rooms: [
          {
            name: "Kitchen",
            dimensions: undefined,
            work_items: ["rewire kitchen ring main only, no other work"],
            // Doesn't match verbatim — a substring of the original.
            removed_work_items: ["rewire kitchen ring main"],
          },
        ],
      }),
    );

    expect(corrected.rooms[0]?.work_items).toEqual(["rewire kitchen ring main only, no other work"]);
  });

  it("leaves other rooms' work items untouched by a removal in a different room", () => {
    const first = mergeSowDelta(
      null,
      delta({
        rooms: [
          { name: "Downstairs", dimensions: undefined, work_items: ["fourteen sockets"], removed_work_items: [] },
          { name: "Upstairs", dimensions: undefined, work_items: ["two sockets"], removed_work_items: [] },
        ],
      }),
    );

    const corrected = mergeSowDelta(
      first,
      delta({
        rooms: [
          { name: "Downstairs", dimensions: undefined, work_items: ["ten sockets"], removed_work_items: ["fourteen sockets"] },
        ],
      }),
    );

    expect(corrected.rooms.find((r) => r.name === "Downstairs")?.work_items).toEqual(["ten sockets"]);
    expect(corrected.rooms.find((r) => r.name === "Upstairs")?.work_items).toEqual(["two sockets"]);
  });
});

// A2 — customer/site contact fields must be captured and correctable like
// any other scalar field (last-value-wins).
describe("mergeSowDelta customer contact capture", () => {
  it("captures customer name, site address, phone and email as they're mentioned", () => {
    const first = mergeSowDelta(null, delta({ customer_name: "Dave Smith" }));
    const second = mergeSowDelta(
      first,
      delta({ site_address: "12 Elm Street, SW1A 1AA", customer_phone: "07123 456789" }),
    );
    const third = mergeSowDelta(second, delta({ customer_email: "dave@example.com" }));

    expect(third.customer_name).toBe("Dave Smith");
    expect(third.site_address).toBe("12 Elm Street, SW1A 1AA");
    expect(third.customer_phone).toBe("07123 456789");
    expect(third.customer_email).toBe("dave@example.com");
  });

  it("lets a later correction overwrite an earlier contact value", () => {
    const first = mergeSowDelta(null, delta({ customer_phone: "07123 456789" }));
    const corrected = mergeSowDelta(first, delta({ customer_phone: "07999 111222" }));
    expect(corrected.customer_phone).toBe("07999 111222");
  });
});

// A5 — timeline synthesis from labour_plan when no plain-English timeline
// was ever stated directly.
describe("synthesizeTimeline", () => {
  it("builds a timeline from people_count and duration_days", () => {
    const result = synthesizeTimeline({
      timeline: undefined,
      labour_plan: { people_count: 2, duration_days: 8 },
      deadline: null,
    });
    expect(result).toBe("Approx. 8 working days, 2-person team");
  });

  it("uses singular 'day' for a one-day job", () => {
    const result = synthesizeTimeline({
      timeline: undefined,
      labour_plan: { people_count: 1, duration_days: 1 },
      deadline: null,
    });
    expect(result).toBe("Approx. 1 working day, 1-person team");
  });

  it("falls back to a stated timeline when no labour_plan is present", () => {
    const result = synthesizeTimeline({
      timeline: "Two weeks, starting Monday",
      labour_plan: null,
      deadline: null,
    });
    expect(result).toBe("Two weeks, starting Monday");
  });

  it("falls back to a neutral message when nothing is known", () => {
    const result = synthesizeTimeline({ timeline: undefined, labour_plan: null, deadline: null });
    expect(result).toBe("To be confirmed before work begins.");
  });

  it("prefers labour_plan over a stated timeline when both are present", () => {
    const result = synthesizeTimeline({
      timeline: "Sometime next month",
      labour_plan: { people_count: 3, duration_days: 5 },
      deadline: null,
    });
    expect(result).toBe("Approx. 5 working days, 3-person team");
  });

  it("appends a stated job deadline as a trailing sentence", () => {
    const result = synthesizeTimeline({
      timeline: undefined,
      labour_plan: { people_count: 2, duration_days: 8 },
      deadline: { quote_by: undefined, job_by: "before Christmas" },
    });
    expect(result).toBe("Approx. 8 working days, 2-person team Needed by: before Christmas.");
  });

  it("appends the deadline even with no labour_plan or stated timeline", () => {
    const result = synthesizeTimeline({
      timeline: undefined,
      labour_plan: null,
      deadline: { quote_by: undefined, job_by: "next Friday" },
    });
    expect(result).toBe("To be confirmed before work begins. Needed by: next Friday.");
  });
});

// A3 — existing_conditions and access_issues must land in separate fields
// even when mentioned in the same turn.
describe("mergeSowDelta field taxonomy", () => {
  it("keeps existing_conditions and access_issues in distinct fields", () => {
    const state = mergeSowDelta(
      null,
      delta({
        existing_conditions: "Old rubber cable throughout, no earthing on lighting circuit",
        access_issues: "Tenant in situ — no access before 9am, keys held by agent",
      }),
    );
    expect(state.existing_conditions).toBe(
      "Old rubber cable throughout, no earthing on lighting circuit",
    );
    expect(state.access_issues).toBe(
      "Tenant in situ — no access before 9am, keys held by agent",
    );
  });

  it("merges labour_plan fields independently across turns", () => {
    const first = mergeSowDelta(null, delta({ labour_plan: { people_count: 2, duration_days: null } }));
    const second = mergeSowDelta(first, delta({ labour_plan: { people_count: null, duration_days: 5 } }));
    expect(second.labour_plan).toEqual({ people_count: 2, duration_days: 5 });
  });

  it("distinguishes quote_by from job_by deadlines", () => {
    const state = mergeSowDelta(
      null,
      delta({ deadline: { quote_by: "Friday", job_by: undefined } }),
    );
    expect(state.deadline).toEqual({ quote_by: "Friday", job_by: undefined });
  });
});

// A4 — exclusions and assumptions must survive the merge with their
// treatment intact, and a repeated mention updates rather than duplicates.
describe("mergeSowDelta inclusions, exclusions and assumptions", () => {
  it("dedupes inclusions/exclusions case-insensitively", () => {
    const first = mergeSowDelta(null, delta({ exclusions: ["Kitchen sockets staying"] }));
    const second = mergeSowDelta(first, delta({ exclusions: ["kitchen sockets staying", "Decorating by customer"] }));
    expect(second.exclusions).toEqual(["Kitchen sockets staying", "Decorating by customer"]);
  });

  it("accumulates additional_items (the catch-all) across turns, deduped", () => {
    const first = mergeSowDelta(null, delta({ additional_items: ["One radiator swap"] }));
    const second = mergeSowDelta(
      first,
      delta({ additional_items: ["one radiator swap", "Haul rubbish away"] }),
    );
    expect(second.additional_items).toEqual(["One radiator swap", "Haul rubbish away"]);
  });

  it("upserts an assumption by description, updating its treatment on repeat mention", () => {
    const first = mergeSowDelta(
      null,
      delta({
        assumptions_and_unknowns: [
          { description: "Couldn't check earthing/bonding", treatment: "assumed_ok" },
        ],
      }),
    );
    const second = mergeSowDelta(
      first,
      delta({
        assumptions_and_unknowns: [
          { description: "Couldn't check earthing/bonding", treatment: "provisional_sum" },
        ],
      }),
    );
    expect(second.assumptions_and_unknowns).toEqual([
      { description: "Couldn't check earthing/bonding", treatment: "provisional_sum" },
    ]);
  });
});

// New checklist fields (crew_description, materials_supply, agreed_costs)
// follow the same nullable-object-as-answered-sentinel convention as
// labour_plan/deadline: null/undefined means "not addressed this turn",
// an explicit object (even with empty arrays / null sub-fields) means
// "asked and confirmed" — this is what getUnansweredChecklistQuestions
// relies on below.
describe("mergeSowDelta materials_supply and agreed_costs", () => {
  it("treats materials_supply as unanswered until an object is explicitly reported", () => {
    const state = mergeSowDelta(null, delta());
    expect(state.materials_supply).toBeNull();
  });

  it("records an explicit 'nothing to report' materials_supply answer", () => {
    const state = mergeSowDelta(
      null,
      delta({ materials_supply: { contractor_supplied: [], customer_supplied: [] } }),
    );
    expect(state.materials_supply).toEqual({ contractor_supplied: [], customer_supplied: [] });
  });

  it("dedupe-appends materials_supply arrays across turns", () => {
    const first = mergeSowDelta(
      null,
      delta({ materials_supply: { contractor_supplied: ["Sockets"], customer_supplied: [] } }),
    );
    const second = mergeSowDelta(
      first,
      delta({
        materials_supply: { contractor_supplied: ["sockets", "Cable"], customer_supplied: ["Tiles"] },
      }),
    );
    expect(second.materials_supply).toEqual({
      contractor_supplied: ["Sockets", "Cable"],
      customer_supplied: ["Tiles"],
    });
  });

  it("carries materials_supply forward unchanged when a turn omits it", () => {
    const first = mergeSowDelta(
      null,
      delta({ materials_supply: { contractor_supplied: ["Sockets"], customer_supplied: [] } }),
    );
    const second = mergeSowDelta(first, delta());
    expect(second.materials_supply).toEqual({ contractor_supplied: ["Sockets"], customer_supplied: [] });
  });

  it("records an explicit 'nothing agreed' agreed_costs answer", () => {
    const state = mergeSowDelta(
      null,
      delta({ agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: null, notes: undefined } }),
    );
    expect(state.agreed_costs).toEqual({
      day_rate: null,
      fixed_price: null,
      deposit_amount: null,
      notes: undefined,
    });
  });

  it("lets a later agreed_costs turn fill in an additional field without clobbering earlier ones", () => {
    const first = mergeSowDelta(
      null,
      delta({ agreed_costs: { day_rate: 200, fixed_price: null, deposit_amount: null, notes: undefined } }),
    );
    const second = mergeSowDelta(
      first,
      delta({
        agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: 300, notes: undefined },
      }),
    );
    expect(second.agreed_costs).toEqual({
      day_rate: 200,
      fixed_price: null,
      deposit_amount: 300,
      notes: undefined,
    });
  });

  it("merges crew_description into labour_plan independently of people_count/duration_days", () => {
    const first = mergeSowDelta(
      null,
      delta({ labour_plan: { people_count: 2, duration_days: null, crew_description: "me and a labourer" } }),
    );
    const second = mergeSowDelta(first, delta({ labour_plan: { people_count: null, duration_days: 5 } }));
    expect(second.labour_plan).toEqual({
      people_count: 2,
      duration_days: 5,
      crew_description: "me and a labourer",
    });
  });
});

describe("sowToExtraction", () => {
  it("passes additional_items through to the drafting extraction so nothing is dropped", () => {
    const extraction = sowToExtraction({
      ...EMPTY_SOW_STATE,
      job_type: "bathroom refit",
      additional_items: ["One radiator swap (heated towel rail)"],
    });
    expect(extraction.additional_items).toEqual(["One radiator swap (heated towel rail)"]);
  });
});

describe("getUnansweredChecklistQuestions", () => {
  it("returns all five questions on an empty SoW", () => {
    expect(getUnansweredChecklistQuestions(EMPTY_SOW_STATE)).toEqual([
      "crew",
      "duration",
      "materials_supply",
      "deadline",
      "agreed_costs",
    ]);
  });

  it("drops a question once its field is answered, even with an empty/null answer", () => {
    const state = mergeSowDelta(
      null,
      delta({
        labour_plan: { people_count: 1, duration_days: 3, crew_description: "just me" },
        materials_supply: { contractor_supplied: [], customer_supplied: [] },
        deadline: { quote_by: undefined, job_by: "before Christmas" },
        agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: null, notes: undefined },
      }),
    );
    expect(getUnansweredChecklistQuestions(state)).toEqual([]);
  });

  it("keeps only the questions genuinely left unanswered", () => {
    const state = mergeSowDelta(
      null,
      delta({
        labour_plan: { people_count: 1, duration_days: 3, crew_description: "just me" },
      }),
    );
    expect(getUnansweredChecklistQuestions(state)).toEqual([
      "materials_supply",
      "deadline",
      "agreed_costs",
    ]);
  });
});
