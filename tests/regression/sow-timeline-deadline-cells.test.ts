import { describe, expect, it } from "vitest";
import { synthesizeDuration, synthesizeTimeline, type SowState } from "@/lib/schemas/sow";

// The statement of work rendered the job deadline TWICE — spliced onto the end
// of the Timeline value by synthesizeTimeline, and again in its own "Job needed
// by" cell. The doubled string overflowed its fifth of the five-column meta row
// and collided with the neighbouring cell, printing
//
//   "Approx. 2 working days, 1-per- 22nd September son team Needed by: 22nd September."
//
// on a customer-facing document: the deadline inside the timeline cell, that
// column apparently empty, and "1-person team" broken mid-word by the overlap.

const sow = {
  timeline: null,
  labour_plan: { duration_days: 2, people_count: 1 },
  deadline: { job_by: "22nd September", quote_by: null },
} as unknown as Pick<SowState, "timeline" | "labour_plan" | "deadline">;

describe("synthesizeDuration", () => {
  it("carries duration and crew only — never the deadline", () => {
    const value = synthesizeDuration(sow);
    expect(value).toBe("Approx. 2 working days, 1-person team");
    expect(value).not.toContain("22nd September");
    expect(value).not.toContain("Needed by");
  });

  it("still lets the priced crew size override an understated labour_plan", () => {
    // The Fenland bug: labour_plan said one person, the pricing paid for two.
    expect(synthesizeDuration(sow, 2)).toBe("Approx. 2 working days, 2-person team");
  });

  it("falls back to something meaningful with no labour plan", () => {
    const bare = { timeline: null, labour_plan: null, deadline: null } as unknown as Pick<
      SowState,
      "timeline" | "labour_plan" | "deadline"
    >;
    expect(synthesizeDuration(bare)).toBe("To be confirmed before work begins.");
  });
});

describe("synthesizeTimeline", () => {
  it("still joins both, for consumers with one prose field and no deadline cell", () => {
    expect(synthesizeTimeline(sow)).toBe(
      "Approx. 2 working days, 1-person team Needed by: 22nd September.",
    );
  });

  it("is the duration alone when nothing was stated", () => {
    const noDeadline = { ...sow, deadline: null } as typeof sow;
    expect(synthesizeTimeline(noDeadline)).toBe(synthesizeDuration(noDeadline));
  });
});
