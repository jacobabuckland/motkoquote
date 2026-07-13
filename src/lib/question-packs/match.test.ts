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
