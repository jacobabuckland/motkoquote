import { describe, expect, it } from "vitest";
import {
  MAX_JOB_TYPE_RECLASSIFICATIONS,
  mergeSowDelta,
  synthesizeTimeline,
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
  inclusions: [],
  exclusions: [],
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
    });
    expect(result).toBe("Approx. 8 working days, 2-person team");
  });

  it("uses singular 'day' for a one-day job", () => {
    const result = synthesizeTimeline({
      timeline: undefined,
      labour_plan: { people_count: 1, duration_days: 1 },
    });
    expect(result).toBe("Approx. 1 working day, 1-person team");
  });

  it("falls back to a stated timeline when no labour_plan is present", () => {
    const result = synthesizeTimeline({ timeline: "Two weeks, starting Monday", labour_plan: null });
    expect(result).toBe("Two weeks, starting Monday");
  });

  it("falls back to a neutral message when nothing is known", () => {
    const result = synthesizeTimeline({ timeline: undefined, labour_plan: null });
    expect(result).toBe("To be confirmed before work begins.");
  });

  it("prefers labour_plan over a stated timeline when both are present", () => {
    const result = synthesizeTimeline({
      timeline: "Sometime next month",
      labour_plan: { people_count: 3, duration_days: 5 },
    });
    expect(result).toBe("Approx. 5 working days, 3-person team");
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
