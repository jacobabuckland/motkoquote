import { describe, expect, it } from "vitest";
import { MAX_JOB_TYPE_RECLASSIFICATIONS, mergeSowDelta, type SowDelta } from "@/lib/schemas/sow";

const delta = (overrides: Partial<SowDelta> = {}): SowDelta => ({
  job_type: undefined,
  rooms: [],
  materials_mentioned: [],
  access_issues: undefined,
  timeline: undefined,
  assumptions: [],
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
