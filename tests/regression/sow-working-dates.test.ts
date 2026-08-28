import { describe, expect, it } from "vitest";
import { mergeSowDelta, synthesizeDuration, synthesizeTimeline, EMPTY_SOW_STATE } from "@/lib/schemas/sow";

// "Tuesday and Wednesday the fifteenth and sixteenth of September" was
// dictated and reached no document. Only "approx. 2 working days" survived:
// the deadline was captured, the duration was captured, and the dates the
// contractor was actually turning up were dropped. The customer could not tell
// when anyone was coming.

describe("working dates are captured", () => {
  it("merges working_dates onto the labour plan", () => {
    const sow = mergeSowDelta(EMPTY_SOW_STATE, {
      labour_plan: {
        duration_days: 2,
        people_count: 1,
        working_dates: "Tuesday and Wednesday the 15th and 16th of September",
      },
    });

    expect(sow.labour_plan?.working_dates).toBe(
      "Tuesday and Wednesday the 15th and 16th of September",
    );
    expect(sow.labour_plan?.duration_days).toBe(2);
  });

  it("keeps a previously captured value when a later turn omits it", () => {
    const first = mergeSowDelta(EMPTY_SOW_STATE, {
      labour_plan: { working_dates: "15th and 16th of September" },
    });
    const second = mergeSowDelta(first, { labour_plan: { people_count: 2 } });

    expect(second.labour_plan?.working_dates).toBe("15th and 16th of September");
    expect(second.labour_plan?.people_count).toBe(2);
  });

  it("is distinct from duration and from the deadline", () => {
    const sow = mergeSowDelta(EMPTY_SOW_STATE, {
      labour_plan: { duration_days: 2, people_count: 1, working_dates: "15th and 16th September" },
      deadline: { job_by: "22nd September" },
    });

    // Three separate facts. None of them absorbs another.
    expect(sow.labour_plan?.working_dates).toBe("15th and 16th September");
    expect(sow.labour_plan?.duration_days).toBe(2);
    expect(sow.deadline?.job_by).toBe("22nd September");

    // The duration phrase stays a duration — it does not swallow the dates.
    const duration = synthesizeDuration(sow);
    expect(duration).toBe("Approx. 2 working days, 1-person team");
    expect(duration).not.toContain("September");

    // And the joined prose variant still carries only the deadline.
    expect(synthesizeTimeline(sow)).toBe(
      "Approx. 2 working days, 1-person team Needed by: 22nd September.",
    );
  });

  it("is absent, not invented, when nothing was said", () => {
    const sow = mergeSowDelta(EMPTY_SOW_STATE, {
      labour_plan: { duration_days: 3 },
    });

    expect(sow.labour_plan?.working_dates ?? null).toBeNull();
  });
});
