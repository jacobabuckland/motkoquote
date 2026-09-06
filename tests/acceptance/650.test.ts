import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  motkoFeePennies,
  FEE_FLOOR_PENNIES,
  FEE_TIER_1_THRESHOLD_PENNIES,
  FEE_TIER_2_THRESHOLD_PENNIES,
  FEE_TIER_1_RATE_BPS,
  FEE_TIER_2_RATE_BPS,
  FEE_TIER_3_RATE_BPS,
} from "@/lib/motko-fee";

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

  it("mentions the floor", () => {
    // Should mention the floor amount
    const floorPounds = (FEE_FLOOR_PENNIES / 100).toFixed(2);
    const hasFloor =
      new RegExp(`£${floorPounds}.*floor`, "i").test(stripeSection) ||
      new RegExp(`floor.*£${floorPounds}`, "i").test(stripeSection) ||
      /£2\.00.*minimum/i.test(stripeSection) ||
      /minimum.*£2\.00/i.test(stripeSection);

    expect(hasFloor).toBe(true);
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

  it("is consistent with the actual fee implementation", () => {
    // Verify the note is describing something that matches what motkoFeePennies
    // actually computes. We don't pin exact values, but we verify the referenced
    // constants exist and are used.

    // The constants should be imported and non-zero
    expect(FEE_FLOOR_PENNIES).toBeGreaterThan(0);
    expect(FEE_TIER_1_THRESHOLD_PENNIES).toBeGreaterThan(0);
    expect(FEE_TIER_2_THRESHOLD_PENNIES).toBeGreaterThan(FEE_TIER_1_THRESHOLD_PENNIES);
    expect(FEE_TIER_1_RATE_BPS).toBeGreaterThan(0);
    expect(FEE_TIER_2_RATE_BPS).toBeGreaterThan(0);
    expect(FEE_TIER_3_RATE_BPS).toBeGreaterThan(0);

    // The function should produce a marginal ladder, not a flat fee:
    // - A small job (£100) should produce the floor
    const smallJobFee = motkoFeePennies(10_000, 0); // £100
    expect(smallJobFee).toBe(FEE_FLOOR_PENNIES);

    // - A £6,000 job should produce more than floor but less than if charged at tier 1 rate throughout
    const midJobValue = 600_000; // £6,000
    const midJobFee = motkoFeePennies(midJobValue, 0);
    expect(midJobFee).toBeGreaterThan(FEE_FLOOR_PENNIES);

    // If it were a flat percentage throughout, the fee would be different
    const flatTier1Fee = Math.round((midJobValue * FEE_TIER_1_RATE_BPS) / 10_000);
    expect(midJobFee).not.toBe(flatTier1Fee); // Proves it's marginal, not flat

    // - A large job (£20,000) should use all three tiers
    const largeJobValue = 2_000_000; // £20,000
    const largeJobFee = motkoFeePennies(largeJobValue, 0);

    // Calculate expected marginal fee manually to prove the ladder exists
    const tier1Fee = (FEE_TIER_1_THRESHOLD_PENNIES * FEE_TIER_1_RATE_BPS) / 10_000;
    const tier2Amount = FEE_TIER_2_THRESHOLD_PENNIES - FEE_TIER_1_THRESHOLD_PENNIES;
    const tier2Fee = (tier2Amount * FEE_TIER_2_RATE_BPS) / 10_000;
    const tier3Amount = largeJobValue - FEE_TIER_2_THRESHOLD_PENNIES;
    const tier3Fee = (tier3Amount * FEE_TIER_3_RATE_BPS) / 10_000;
    const expectedFee = Math.round(tier1Fee + tier2Fee + tier3Fee);

    expect(largeJobFee).toBe(Math.max(expectedFee, FEE_FLOOR_PENNIES));

    // This proves the implementation is a marginal ladder with a floor and no cap,
    // which is what the note must describe.
  });
});
