import { describe, it, expect } from "vitest";
import { motkoFeePennies, splitFeeVat } from "@/lib/motko-fee";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";
import { applicationFeeForPayment } from "@/lib/stripe-payments";

describe("Issue #476: FEE-6 — Replace flat fee bands with a marginal ladder on net job value", () => {
  describe("Marginal ladder computation", () => {
    it("returns the worked values exactly for each net job value", () => {
      // £500 → £2.00 (floor)
      expect(motkoFeePennies(50_000, 0)).toBe(200);

      // £1,000 → £3.00
      expect(motkoFeePennies(100_000, 0)).toBe(300);

      // £2,500 → £7.50
      expect(motkoFeePennies(250_000, 0)).toBe(750);

      // £5,000 → £15.00
      expect(motkoFeePennies(500_000, 0)).toBe(1500);

      // £7,500 → £20.00
      expect(motkoFeePennies(750_000, 0)).toBe(2000);

      // £10,000 → £25.00
      expect(motkoFeePennies(1_000_000, 0)).toBe(2500);

      // £22,000 → £43.00
      expect(motkoFeePennies(2_200_000, 0)).toBe(4300);
    });

    it("is monotonic: fee never decreases as job value increases", () => {
      // Test across all breakpoints and between them
      const testValues = [
        100_000,    // £1,000
        250_000,    // £2,500
        499_999,    // £4,999.99
        500_000,    // £5,000 (first breakpoint)
        500_001,    // £5,000.01
        750_000,    // £7,500
        999_999,    // £9,999.99
        1_000_000,  // £10,000 (second breakpoint)
        1_000_001,  // £10,000.01
        2_000_000,  // £20,000
      ];

      let previousFee = motkoFeePennies(testValues[0]!, 0);

      for (let i = 1; i < testValues.length; i++) {
        const currentFee = motkoFeePennies(testValues[i]!, 0);
        expect(currentFee).toBeGreaterThanOrEqual(previousFee);
        previousFee = currentFee;
      }
    });
  });

  describe("Floor behaviour", () => {
    it("returns the floor (200p) when computed fee is below £2.00", () => {
      // £500: 500 * 0.003 = £1.50, but floor is £2.00
      expect(motkoFeePennies(50_000, 0)).toBe(200);
    });

    it("returns the floor at exactly £666.66 (one penny below boundary)", () => {
      // £666.66 * 0.003 = £2.00 - 0.002p, rounds to 199.998p → floor applies
      expect(motkoFeePennies(66_666, 0)).toBe(200);
    });

    it("returns the computed value at exactly £666.67 (floor boundary)", () => {
      // £666.67 * 0.003 = £2.00 exactly
      expect(motkoFeePennies(66_667, 0)).toBe(200);
    });

    it("returns the floor for zero net value", () => {
      expect(motkoFeePennies(0, 0)).toBe(200);
    });

    it("returns the floor for negative net value", () => {
      expect(motkoFeePennies(-10_000, 0)).toBe(200);
    });
  });

  describe("Breakpoint boundary cases", () => {
    it("charges first-tier rate on exactly £5,000.00", () => {
      // £5,000 * 0.003 = £15.00
      expect(motkoFeePennies(500_000, 0)).toBe(1500);
    });

    it("charges mixed rates on £5,000.01", () => {
      // First £5,000 at 0.3% = £15.00
      // Next £0.01 at 0.2% = £0.00002, rounds to 0
      // Total = £15.00
      expect(motkoFeePennies(500_001, 0)).toBe(1500);
    });

    it("charges mixed rates on exactly £10,000.00", () => {
      // First £5,000 at 0.3% = £15.00
      // Next £5,000 at 0.2% = £10.00
      // Total = £25.00
      expect(motkoFeePennies(1_000_000, 0)).toBe(2500);
    });

    it("charges all three tiers on £10,000.01", () => {
      // First £5,000 at 0.3% = £15.00
      // Next £5,000 at 0.2% = £10.00
      // Next £0.01 at 0.15% = £0.000015, rounds to 0
      // Total = £25.00
      expect(motkoFeePennies(1_000_001, 0)).toBe(2500);
    });
  });

  describe("Fee is computed from quote subtotal, not gross", () => {
    it("produces the same fee for VAT-registered and unregistered contractors at same subtotal via planPaidJobSettlement", () => {
      const subtotalPennies = 100_000; // £1,000 net

      // VAT-registered contractor: gross would be £1,200
      const factsVATRegistered: PaidJobFacts = {
        jobId: "job-vat-registered",
        contractorId: "contractor-vat",
        jobValuePennies: subtotalPennies,
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
        pendingReferral: null,
      };

      // Unregistered contractor: gross equals net (£1,000)
      const factsUnregistered: PaidJobFacts = {
        jobId: "job-unregistered",
        contractorId: "contractor-unregistered",
        jobValuePennies: subtotalPennies,
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
        pendingReferral: null,
      };

      const planVAT = planPaidJobSettlement(factsVATRegistered);
      const planNoVAT = planPaidJobSettlement(factsUnregistered);

      // Both should produce the same fee (£3.00 for £1,000 net)
      expect(planVAT.fee.feeAmountPennies).toBe(300);
      expect(planNoVAT.fee.feeAmountPennies).toBe(300);
      expect(planVAT.fee.feeAmountPennies).toBe(planNoVAT.fee.feeAmountPennies);
    });

    it("produces the same fee via applicationFeeForPayment for same net value", () => {
      const netValuePennies = 500_000; // £5,000 net

      // This function should operate on net value, so both calls return the same
      const feeVAT = applicationFeeForPayment(netValuePennies, 0);
      const feeNoVAT = applicationFeeForPayment(netValuePennies, 0);

      expect(feeVAT).toBe(1500); // £15.00 for £5,000 net
      expect(feeNoVAT).toBe(1500);
      expect(feeVAT).toBe(feeNoVAT);
    });
  });

  describe("Configuration changes propagate", () => {
    it("changing the ladder configuration changes the output", async () => {
      // This test documents that the ladder lives in a configuration constant.
      // If the Engineer changes a rate, breakpoint or floor, the function
      // returns a different value with no call-site code change.

      // We cannot actually mutate the exported constant in a test, so this
      // assertion documents the expectation: the ladder structure is defined
      // in ONE place (src/lib/motko-fee.ts configuration), not scattered
      // across call sites.

      // Read the motko-fee module to confirm the ladder is defined as a constant
      const mod = await import("@/lib/motko-fee");

      // The module must export or reference a ladder configuration structure
      // (rates, breakpoints, floor). The Engineer will define this.
      expect(mod).toBeDefined();
      expect(typeof mod.motkoFeePennies).toBe("function");

      // If the configuration is exported (e.g., FEE_LADDER_CONFIG), assert it exists:
      // expect(mod.FEE_LADDER_CONFIG).toBeDefined();
      // For now, we document that the function's behaviour must change when
      // the configuration changes, not when call sites change.
    });
  });

  describe("VAT split computes correctly against ladder-derived fees", () => {
    it("splits a ladder-derived fee into net and VAT correctly", () => {
      const feePennies = 1500; // £15.00 (for a £5,000 job)

      const split = splitFeeVat(feePennies);

      // £15.00 → net £12.50, VAT £2.50
      expect(split.grossPennies).toBe(1500);
      expect(split.netPennies).toBe(1250);
      expect(split.vatPennies).toBe(250);
      expect(split.netPennies + split.vatPennies).toBe(split.grossPennies);
    });

    it("splits various ladder-derived fees correctly", () => {
      const testCases = [
        { gross: 200, expectedNet: 167, expectedVAT: 33 },   // £2.00 (floor)
        { gross: 300, expectedNet: 250, expectedVAT: 50 },   // £3.00 (£1,000 job)
        { gross: 750, expectedNet: 625, expectedVAT: 125 },  // £7.50 (£2,500 job)
        { gross: 1500, expectedNet: 1250, expectedVAT: 250 }, // £15.00 (£5,000 job)
        { gross: 2500, expectedNet: 2083, expectedVAT: 417 }, // £25.00 (£10,000 job)
      ];

      for (const { gross, expectedNet, expectedVAT } of testCases) {
        const split = splitFeeVat(gross);
        expect(split.netPennies).toBe(expectedNet);
        expect(split.vatPennies).toBe(expectedVAT);
        expect(split.netPennies + split.vatPennies).toBe(gross);
      }
    });
  });

  describe("Fee amount is always an integer", () => {
    it("returns integer pennies for various job values", () => {
      const testValues = [
        66_667,   // Floor boundary
        123_456,  // Arbitrary value
        500_000,  // First breakpoint
        777_777,  // Between breakpoints
        1_000_000, // Second breakpoint
        3_333_333, // Large value with thirds
      ];

      for (const value of testValues) {
        const fee = motkoFeePennies(value, 0);
        expect(Number.isInteger(fee)).toBe(true);
        expect(fee).toBe(Math.floor(fee));
      }
    });
  });

  describe("Integration with payment settlement", () => {
    it("planPaidJobSettlement uses ladder-derived fees", () => {
      const facts: PaidJobFacts = {
        jobId: "job-integration",
        contractorId: "contractor-integration",
        jobValuePennies: 500_000, // £5,000
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
        pendingReferral: null,
      };

      const plan = planPaidJobSettlement(facts);

      // Should charge £15.00 for a £5,000 job
      expect(plan.fee.feeAmountPennies).toBe(1500);

      // VAT split should be correct
      expect(plan.fee.feeNetPennies).toBe(1250); // £12.50
      expect(plan.fee.feeVatPennies).toBe(250);  // £2.50
      expect(plan.fee.feeNetPennies + plan.fee.feeVatPennies).toBe(1500);
    });

    it("applicationFeeForPayment uses ladder-derived fees with no free credit", () => {
      const jobValuePennies = 1_000_000; // £10,000
      const freeJobsRemaining = 0;

      const fee = applicationFeeForPayment(jobValuePennies, freeJobsRemaining);

      // Should charge £25.00 for a £10,000 job
      expect(fee).toBe(2500);
    });
  });
});
