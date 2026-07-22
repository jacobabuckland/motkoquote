import { describe, expect, it } from "vitest";
import {
  FEE_BAND_THRESHOLD_PENNIES,
  FEE_LARGE_PENNIES,
  FEE_STANDARD_PENNIES,
  motkoFeePennies,
} from "@/lib/motko-fee";

describe("motkoFeePennies", () => {
  it("waives the fee entirely while free jobs remain — whatever the job value", () => {
    expect(motkoFeePennies(50_000, 5)).toBe(0);
    expect(motkoFeePennies(500_000, 1)).toBe(0);
  });

  it("charges the £2 band for a paid job up to £1,000", () => {
    expect(motkoFeePennies(50_000, 0)).toBe(FEE_STANDARD_PENNIES);
  });

  it("treats exactly £1,000 as the £2 band (inclusive boundary)", () => {
    expect(motkoFeePennies(FEE_BAND_THRESHOLD_PENNIES, 0)).toBe(FEE_STANDARD_PENNIES);
  });

  it("charges the £4 band one penny above £1,000", () => {
    expect(motkoFeePennies(FEE_BAND_THRESHOLD_PENNIES + 1, 0)).toBe(FEE_LARGE_PENNIES);
  });

  it("caps at £4 no matter how large the job", () => {
    expect(motkoFeePennies(400_000, 0)).toBe(FEE_LARGE_PENNIES);
    expect(motkoFeePennies(50_000_000, 0)).toBe(FEE_LARGE_PENNIES);
  });

  it("starts charging the moment the allowance is exhausted", () => {
    expect(motkoFeePennies(80_000, 1)).toBe(0);
    expect(motkoFeePennies(80_000, 0)).toBe(FEE_STANDARD_PENNIES);
  });
});
