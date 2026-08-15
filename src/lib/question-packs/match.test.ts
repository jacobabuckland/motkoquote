import { describe, expect, it } from "vitest";
import { matchJobTypeToPack, resolveSlotDefault } from "@/lib/question-packs/match";

describe("matchJobTypeToPack", () => {
  it("finds a pack by normalized job_type", () => {
    const pack = matchJobTypeToPack("Full Rewire");
    expect(pack?.job_type).toBe("full rewire");
  });

  it("returns undefined for an uncovered job type", () => {
    expect(matchJobTypeToPack("garden decking")).toBeUndefined();
  });

  it("matches a pack via a synonym that classifies to the same category", () => {
    // "rewiring" and "house rewire" both classify to `rewire`, the category of
    // the "full rewire" pack — the old exact-string compare missed these.
    expect(matchJobTypeToPack("rewiring")?.job_type).toBe("full rewire");
    expect(matchJobTypeToPack("house rewire")?.job_type).toBe("full rewire");
    // "boiler swap" / "combi boiler" classify to `boiler`.
    expect(matchJobTypeToPack("boiler swap")?.job_type).toBe("boiler replacement");
    expect(matchJobTypeToPack("combi boiler")?.job_type).toBe("boiler replacement");
  });

  it("returns undefined for a covered category with no authored pack", () => {
    // downlights / door hanging / cooker circuit classify to real categories
    // but have no pack yet, so they still fall back to the generic flow.
    expect(matchJobTypeToPack("spotlights")).toBeUndefined();
    expect(matchJobTypeToPack("hanging four doors")).toBeUndefined();
    expect(matchJobTypeToPack("wiring a new hob")).toBeUndefined();
  });

  it("never matches a pack for a 'general' job type", () => {
    expect(matchJobTypeToPack("plastering")).toBeUndefined();
    expect(matchJobTypeToPack("")).toBeUndefined();
  });
});

describe("resolveSlotDefault", () => {
  const pack = matchJobTypeToPack("full rewire")!;
  const accessSlot = pack.slots.find((slot) => slot.key === "access_difficulty")!;

  it("prefers a matching contractor rate card over the pack default", () => {
    const resolved = resolveSlotDefault(accessSlot, [
      { work_type: "access_difficulty", rate_per_unit: 1.75 },
    ]);
    expect(resolved).toEqual({ value: 1.75, source: "rate_card" });
  });

  it("falls back to the pack's static default_value when no rate card matches", () => {
    const resolved = resolveSlotDefault(accessSlot, []);
    expect(resolved).toEqual({ value: false, source: "pack_default" });
  });

  it("returns undefined when neither a rate card nor a default_value exists", () => {
    const requiredSlot = pack.slots.find((slot) => slot.priority === "required")!;
    expect(resolveSlotDefault(requiredSlot, [])).toBeUndefined();
  });
});
