import { describe, expect, it } from "vitest";
import { classifyJobType, type JobCategory } from "@/lib/question-packs/classify";

describe("classifyJobType", () => {
  const cases: [string, JobCategory][] = [
    // downlights + its synonyms (audit sessions A and C)
    ["downlights", "downlights"],
    ["four downlights", "downlights"],
    ["spotlights", "downlights"],
    ["spot lights", "downlights"],
    ["ceiling lighting", "downlights"],
    ["10 recessed lights", "downlights"],
    // door hanging (audit session B)
    ["door hanging", "door_hanging"],
    ["hanging four doors", "door_hanging"],
    ["fitting doors", "door_hanging"],
    ["internal door", "door_hanging"],
    // cooker circuit (audit session A "rewire of a hob")
    ["cooker circuit", "cooker_circuit"],
    ["wiring a new hob", "cooker_circuit"],
    ["rewire of a hob", "cooker_circuit"],
    ["oven circuit", "cooker_circuit"],
    // rewire — including the existing pack's own job_type
    ["full rewire", "rewire"],
    ["house rewire", "rewire"],
    ["rewiring", "rewire"],
    // boiler — including the existing pack's own job_type
    ["boiler replacement", "boiler"],
    ["boiler swap", "boiler"],
    ["combi boiler", "boiler"],
    // rooms
    ["bathroom", "bathroom"],
    ["en-suite", "bathroom"],
    ["wet room", "bathroom"],
    ["kitchen", "kitchen"],
    // no match
    ["garden decking", "general"],
    ["plastering", "general"],
    ["", "general"],
  ];

  for (const [input, expected] of cases) {
    it(`classifies ${JSON.stringify(input)} as ${expected}`, () => {
      expect(classifyJobType(input)).toBe(expected);
    });
  }

  it("is case- and whitespace-insensitive", () => {
    expect(classifyJobType("  Full   REWIRE ")).toBe("rewire");
    expect(classifyJobType("SPOTLIGHTS")).toBe("downlights");
  });

  it("prefers the more specific task over a room when both appear", () => {
    // "kitchen downlights" is a downlights job, not classified by the room.
    expect(classifyJobType("kitchen downlights")).toBe("downlights");
    // A hob circuit in the kitchen is cooker_circuit, not kitchen.
    expect(classifyJobType("hob circuit in the kitchen")).toBe("cooker_circuit");
  });

  it("prefers cooker_circuit over a bare rewire mention for a hob", () => {
    // Audit session A: "a rewire of a hob" is a cooker circuit, not a house rewire.
    expect(classifyJobType("a rewire of a hob")).toBe("cooker_circuit");
  });
});
