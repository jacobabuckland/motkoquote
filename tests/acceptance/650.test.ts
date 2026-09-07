import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("CLEAN-4: .env.example fee note accuracy", () => {
  const envExamplePath = join(process.cwd(), ".env.example");
  const envExample = readFileSync(envExamplePath, "utf-8");

  // Located by content, not by line number. `.env.example` gains and loses
  // entries constantly, and a fixed offset does not fail when that happens —
  // it silently starts asserting against a different block. The note is unique
  // in the file, so anchor on it and take a window around it.
  const feeNoteIndex = envExample.indexOf("NOTE: there is no fee env var");
  const stripeSection =
    feeNoteIndex === -1
      ? ""
      : envExample.slice(Math.max(0, feeNoteIndex - 200), feeNoteIndex + 500);

  it("keeps the note that there is no fee env var", () => {
    // The anchor above is only sound while this holds, and the note saying so
    // is itself a requirement of the item.
    expect(feeNoteIndex).toBeGreaterThan(-1);
  });

  it("does not claim the fee is flat or capped", () => {
    // The false claims in the current note
    expect(stripeSection).not.toMatch(/\bflat\b/i);
    expect(stripeSection).not.toMatch(/\bcapped\b/i);
    expect(stripeSection).not.toMatch(/£2\/£4/);
  });

  it("describes the marginal percentage ladder", () => {
    // The note should mention that it's marginal/tiered/ladder-based
    const hasMarginalConcept =
      /marginal/i.test(stripeSection) ||
      /ladder/i.test(stripeSection) ||
      /tier/i.test(stripeSection) ||
      /percentage/i.test(stripeSection);

    expect(hasMarginalConcept).toBe(true);
  });


  it("indicates there is no cap", () => {
    // Should state or imply no cap
    const hasNoCap =
      /no cap/i.test(stripeSection) ||
      /uncapped/i.test(stripeSection) ||
      /without.*cap/i.test(stripeSection);

    expect(hasNoCap).toBe(true);
  });

  it("still states the fee is not configurable per environment", () => {
    expect(stripeSection).toMatch(/not configurable/i);
    expect(stripeSection).toMatch(/no fee env var/i);
  });

});
