import { describe, expect, it } from "vitest";
import {
  FEE_STANDARD_PENNIES,
  FEE_FLOOR_PENNIES,
  splitFeeVat,
  motkoFeePennies,
} from "@/lib/motko-fee";

describe("motkoFeePennies", () => {
  it("waives the fee entirely while free jobs remain — whatever the job value", () => {
    expect(motkoFeePennies(50_000, 5)).toBe(0);
    expect(motkoFeePennies(500_000, 1)).toBe(0);
  });

  it("returns the floor (£2) for small jobs where computed fee is below floor", () => {
    expect(motkoFeePennies(50_000, 0)).toBe(200); // £500 → £2 floor
  });

  it("returns £3 for a £1,000 job", () => {
    expect(motkoFeePennies(100_000, 0)).toBe(300); // £1,000 * 0.3% = £3
  });

  it("returns £15 for a £5,000 job", () => {
    expect(motkoFeePennies(500_000, 0)).toBe(1500); // £5,000 * 0.3% = £15
  });

  it("charges mixed rates above £5,000", () => {
    expect(motkoFeePennies(750_000, 0)).toBe(2000); // £7,500 → £20
  });

  it("charges all three tiers for large jobs with no cap", () => {
    expect(motkoFeePennies(1_000_000, 0)).toBe(2500); // £10,000 → £25
    expect(motkoFeePennies(2_200_000, 0)).toBe(4300); // £22,000 → £43
  });

  it("starts charging the moment the allowance is exhausted", () => {
    expect(motkoFeePennies(80_000, 1)).toBe(0);
    expect(motkoFeePennies(80_000, 0)).toBe(240); // £800 * 0.3% = £2.40
  });

  it("returns the floor for zero or negative job values", () => {
    expect(motkoFeePennies(0, 0)).toBe(FEE_FLOOR_PENNIES);
    expect(motkoFeePennies(-10_000, 0)).toBe(FEE_FLOOR_PENNIES);
  });
});

describe("splitFeeVat — VAT-inclusive split of the ladder-derived fee", () => {
  it("splits the floor fee (£2) into net £1.67 + VAT £0.33", () => {
    expect(splitFeeVat(FEE_STANDARD_PENNIES)).toEqual({
      grossPennies: 200,
      netPennies: 167,
      vatPennies: 33,
    });
  });

  it("splits ladder-derived fees correctly", () => {
    // £15 for a £5,000 job
    expect(splitFeeVat(1500)).toEqual({
      grossPennies: 1500,
      netPennies: 1250,
      vatPennies: 250,
    });

    // £25 for a £10,000 job
    expect(splitFeeVat(2500)).toEqual({
      grossPennies: 2500,
      netPennies: 2083,
      vatPennies: 417,
    });
  });

  it("never alters the amount collected — net + vat always equals gross", () => {
    for (const gross of [0, 1, 199, 200, 333, 400, 1234, 99_999]) {
      const split = splitFeeVat(gross);
      expect(split.netPennies + split.vatPennies).toBe(gross);
      expect(split.grossPennies).toBe(gross);
    }
  });

  it("splits a £0 (waived) fee into all zeros", () => {
    expect(splitFeeVat(0)).toEqual({ grossPennies: 0, netPennies: 0, vatPennies: 0 });
  });
});
