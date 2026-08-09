import { describe, expect, it } from "vitest";
import {
  EMPTY_SOW_STATE,
  getUnansweredChecklistQuestions,
  getUnansweredRequiredChecklistQuestions,
  mergeSowDelta,
  resolvePricingMode,
  summarizeRequiredSlotCoverage,
  type PricingMode,
  type SowDelta,
  type SowState,
} from "@/lib/schemas/sow";

// Issue #78 — the merged duration/pricing-mode slot must be gated on the
// contractor having EXPLICITLY chosen how the job is priced. A duration
// mentioned in passing while describing the job ("it'll be about four days")
// fills labour_plan.duration_days and, today, silently satisfies the slot —
// so the pricing question is never asked and resolvePricingMode answers
// "calculated" for a decision nobody made. See docs/specs/78.md.

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
  pricing: undefined,
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

// "Eight double sockets downstairs... it'll be about four days, me and Liam."
// Crew and materials were properly asked and answered; the duration fell out
// of the job description. The pricing question was never put to them.
const incidentalDurationOnly = (): SowState =>
  mergeSowDelta(
    null,
    delta({
      job_type: "electrical",
      rooms: [{ name: "Downstairs", dimensions: undefined, work_items: ["Eight double sockets"], removed_work_items: [] }],
      labour_plan: { people_count: 2, duration_days: 4, crew_description: "me and Liam" },
      materials_supply: { contractor_supplied: ["Cable", "Sockets"], customer_supplied: [] },
    }),
  );

describe("#78 the pricing slot is gated on an explicit pricing.mode", () => {
  it("leaves the slot unanswered after an incidental duration mention with no pricing statement", () => {
    const sow = incidentalDurationOnly();

    // Precondition: the duration landed, the pricing question never did.
    expect(sow.labour_plan?.duration_days).toBe(4);
    expect(sow.pricing).toBeNull();

    expect(getUnansweredChecklistQuestions(sow)).toContain("duration");
  });

  it("still asks the pricing question at the end-of-call safety net when the mode is unset", () => {
    // getUnansweredRequiredChecklistQuestions is what concludeOrAskRequired
    // detours on, so a call cannot wrap cleanly with the mode unset and unasked.
    expect(getUnansweredRequiredChecklistQuestions(incidentalDurationOnly())).toEqual(["duration"]);
  });

  it("counts a duration-only session's pricing slot as unknown, not answered", () => {
    expect(
      summarizeRequiredSlotCoverage(incidentalDurationOnly(), [
        "crew",
        "duration",
        "materials_supply",
      ]),
    ).toEqual({ asked: 3, answered: 2, unknown: 1 });
  });

  it("does not resolve an unset pricing mode to a silent 'calculated'", () => {
    // Mechanism-agnostic on purpose: docs/specs/78.md flags "unset is an error
    // state, not a fallback" as needing a decision between throwing and
    // returning null. What is NOT in question is that an unset mode must not
    // come back as a mode the contractor never chose.
    for (const sow of [EMPTY_SOW_STATE, incidentalDurationOnly()]) {
      const outcome = resolveOutcome(sow);
      expect(outcome.value).not.toBe("calculated");
      expect(outcome.threw || outcome.value == null).toBe(true);
    }
  });
});

describe("#78 an explicitly chosen mode still answers the slot", () => {
  it("accepts every mode, with or without a stated duration", () => {
    for (const mode of ["days", "fixed", "calculated"] as const) {
      const sow = mergeSowDelta(
        null,
        delta({ pricing: { mode, fixed_amount: mode === "fixed" ? 2000 : null } }),
      );
      expect(getUnansweredChecklistQuestions(sow)).not.toContain("duration");
      expect(getUnansweredRequiredChecklistQuestions(sow)).not.toContain("duration");
      expect(resolveOutcome(sow)).toEqual({ threw: false, value: mode });
    }
  });

  it("settles the slot in one answer when days and crew arrive together", () => {
    // "Four days, me and Liam" — the merged slot, answered properly.
    const sow = mergeSowDelta(
      null,
      delta({
        labour_plan: { people_count: 2, duration_days: 4, crew_description: "me and Liam" },
        pricing: { mode: "days", fixed_amount: null },
        materials_supply: { contractor_supplied: ["Cable"], customer_supplied: [] },
      }),
    );
    expect(getUnansweredRequiredChecklistQuestions(sow)).toEqual([]);
    expect(
      summarizeRequiredSlotCoverage(sow, ["crew", "duration", "materials_supply"]),
    ).toEqual({ asked: 3, answered: 3, unknown: 0 });
  });
});

// resolvePricingMode's signature is expected to change (see docs/specs/78.md),
// so call it through a wrapper that records either return value or throw and
// leaves the mechanism to the implementation.
const resolveOutcome = (
  sow: Pick<SowState, "pricing">,
): { threw: boolean; value: PricingMode | null | undefined } => {
  try {
    return { threw: false, value: resolvePricingMode(sow) };
  } catch {
    return { threw: true, value: undefined };
  }
};
