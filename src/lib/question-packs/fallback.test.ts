import { describe, expect, it } from "vitest";
import { usedGenericFallback } from "@/lib/question-packs/fallback";

describe("usedGenericFallback", () => {
  it("is false when the job type has a matching pack", () => {
    expect(usedGenericFallback("full rewire")).toBe(false);
  });

  it("is true when no pack covers the job type", () => {
    expect(usedGenericFallback("garden decking")).toBe(true);
  });
});
