import { describe, expect, it } from "vitest";
import {
  FEE_CAP_BINDS_AT_PENNIES,
  FEE_CAP_PENNIES,
  feeWouldSwallowPayment,
  splitFeeVat,
  motkoFeePennies,
  waiverSplit,
} from "@/lib/motko-fee";

describe("motkoFeePennies — SUB-3's schedule: 0.99% + 39.6p, capped at £9.90", () => {
  it("waives the fee entirely while free jobs remain — whatever the job value", () => {
    expect(motkoFeePennies(50_000, 5)).toBe(0);
    expect(motkoFeePennies(500_000, 1)).toBe(0);
  });

  // The five values SUB-3's acceptance criterion names, worked by hand from the
  // schedule rather than from the implementation.
  it("charges 41p on a £1 job", () => {
    // 0.99% of 100p = 0.99p, + 39.6p = 40.59p
    expect(motkoFeePennies(100, 0)).toBe(41);
  });

  it("charges 89p on a £50 job", () => {
    // 0.99% of 5,000p = 49.5p, + 39.6p = 89.1p
    expect(motkoFeePennies(5_000, 0)).toBe(89);
  });

  it("charges £1.39 on a £100 job — the spec's own worked example", () => {
    // 0.99% of 10,000p = 99p, + 39.6p = 138.6p. Rounding half up gives 139.
    // Truncating gives 138 and makes every fee a penny light, which is the
    // reason the rounding is pinned here rather than left to taste.
    expect(motkoFeePennies(10_000, 0)).toBe(139);
  });

  it("charges the cap on a £992.50 job — the median", () => {
    // 0.99% of 99,250p = 982.575p, + 39.6p = 1,022.175p, which is over the cap.
    expect(motkoFeePennies(99_250, 0)).toBe(990);
  });

  it("charges the cap on a £9,000 job", () => {
    expect(motkoFeePennies(900_000, 0)).toBe(990);
  });

  it("rounds half up rather than truncating", () => {
    // £100 is the case that separates them, and it is the spec's table value.
    expect(motkoFeePennies(10_000, 0)).not.toBe(138);
  });

  describe("the cap", () => {
    it("binds at exactly £960, where the published constant says", () => {
      // 0.99% of 96,000p = 950.4p, + 39.6p = exactly 990p.
      expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES, 0)).toBe(FEE_CAP_PENNIES);
    });

    it("is not yet binding a penny below it", () => {
      expect(motkoFeePennies(FEE_CAP_BINDS_AT_PENNIES - 100, 0)).toBeLessThan(
        FEE_CAP_PENNIES,
      );
    });

    it("holds however large the job", () => {
      expect(motkoFeePennies(10_000_000, 0)).toBe(FEE_CAP_PENNIES);
      expect(motkoFeePennies(100_000_000, 0)).toBe(FEE_CAP_PENNIES);
    });
  });

  describe("no job loses money", () => {
    // The schedule is 1.65× motko's real Stripe cost (0.6% + 24p capped at
    // £6.00), cap and knee included. Asserting the margin directly is what makes
    // "no job loses money by construction" a checked claim rather than a comment.
    const stripeCostPennies = (jobValuePennies: number) =>
      Math.min((jobValuePennies * 60) / 10_000 + 24, 600);

    it("keeps margin at 0.65 × cost across the range", () => {
      for (const value of [100, 5_000, 10_000, 50_000, 96_000, 99_250, 900_000]) {
        const charged = motkoFeePennies(value, 0);
        const cost = stripeCostPennies(value);

        expect(charged).toBeGreaterThan(cost);
        // Within a penny, since the charged figure is rounded and the cost is not.
        expect(Math.abs(charged - cost * 1.65)).toBeLessThanOrEqual(1);
      }
    });
  });

  it("charges nothing on a zero or negative job value", () => {
    // There is no percentage component to charge. Returning the fixed component
    // alone would bill 40p against nothing.
    expect(motkoFeePennies(0, 0)).toBe(0);
    expect(motkoFeePennies(-10_000, 0)).toBe(0);
  });

  it("starts charging the moment the allowance is exhausted", () => {
    expect(motkoFeePennies(80_000, 1)).toBe(0);
    // 0.99% of 80,000p = 792p, + 39.6p = 831.6p
    expect(motkoFeePennies(80_000, 0)).toBe(832);
  });
});

describe("feeWouldSwallowPayment", () => {
  it("is true when the fee meets or exceeds the payment", () => {
    expect(feeWouldSwallowPayment(41, 41)).toBe(true);
    expect(feeWouldSwallowPayment(41, 40)).toBe(true);
  });

  it("is false when the payment is larger", () => {
    expect(feeWouldSwallowPayment(41, 42)).toBe(false);
  });

  it("catches the small jobs the schedule cannot serve", () => {
    // A 40p job costs 40p in fee — the guard is what stops motko taking all of
    // it and the trade receiving nothing.
    expect(feeWouldSwallowPayment(motkoFeePennies(40, 0), 40)).toBe(true);
    // A £5 job pays 44p and keeps the rest.
    expect(feeWouldSwallowPayment(motkoFeePennies(500, 0), 500)).toBe(false);
  });
});

describe("waiverSplit under the new schedule", () => {
  it("waives a free job in full, at any value", () => {
    // The £2 ceiling is gone, so a free job is free whatever it is worth. Until
    // SUB-3 the Stripe call site waived only £2 of this while settlement waived
    // it all, so a "free" job over £666.67 was charged the difference at source.
    expect(waiverSplit(motkoFeePennies(99_250, 0))).toEqual({
      waivedPennies: 990,
      payablePennies: 0,
    });
  });
});

describe("splitFeeVat — describing a fee, never altering it", () => {
  it("splits the cap (£9.90) into net £8.25 + VAT £1.65", () => {
    expect(splitFeeVat(FEE_CAP_PENNIES)).toEqual({
      grossPennies: 990,
      netPennies: 825,
      vatPennies: 165,
    });
  });

  it("splits a schedule-derived fee correctly", () => {
    // £1.39 on a £100 job
    expect(splitFeeVat(139)).toEqual({
      grossPennies: 139,
      netPennies: 116,
      vatPennies: 23,
    });
  });

  it("never alters the amount collected — net + vat always equals gross", () => {
    for (const gross of [0, 1, 41, 89, 139, 200, 990, 1234, 99_999]) {
      const split = splitFeeVat(gross);
      expect(split.netPennies + split.vatPennies).toBe(gross);
      expect(split.grossPennies).toBe(gross);
    }
  });

  it("splits a £0 (waived) fee into all zeros", () => {
    expect(splitFeeVat(0)).toEqual({ grossPennies: 0, netPennies: 0, vatPennies: 0 });
  });
});
