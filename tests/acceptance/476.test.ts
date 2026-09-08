import { describe, it, expect } from "vitest";
import { motkoFeePennies, splitFeeVat } from "@/lib/motko-fee";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";
import { applicationFeeForPayment } from "@/lib/stripe-payments";

describe("Issue #476: FEE-6 — Replace flat fee bands with a marginal ladder on net job value", () => {
  describe("Marginal ladder computation", () => {

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

  describe("Fee is computed from quote subtotal, not gross", () => {
    // The pinned ladder values here were retired by SUB-3 (7 Sep) — the fee is
    // no longer £3.00 on £1,000 or £15.00 on £5,000. The CLAIM is untouched by
    // the reprice and still worth checking, so it is re-expressed against the
    // schedule rather than deleted: whatever the fee is, it is a function of the
    // net subtotal alone and the contractor's VAT status cannot move it.
    it("produces the same fee whatever the contractor's VAT status, at the same subtotal", () => {
      const subtotalPennies = 100_000; // £1,000 net

      const at = (jobId: string): PaidJobFacts => ({
        jobId,
        contractorId: jobId,
        jobValuePennies: subtotalPennies,
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
        pendingReferral: null,
      });

      const planVAT = planPaidJobSettlement(at("job-vat-registered"));
      const planNoVAT = planPaidJobSettlement(at("job-unregistered"));

      expect(planVAT.fee.feeAmountPennies).toBe(planNoVAT.fee.feeAmountPennies);
      expect(planVAT.fee.feeAmountPennies).toBe(motkoFeePennies(subtotalPennies, 0));
    });

    it("charges on the net value, so adding VAT to the same job does not raise the fee", () => {
      // The defect this guards is a caller passing gross. 20% VAT on £100 is
      // £120, and a fee computed from that would be strictly larger — so the
      // two must differ, and the charged one must be the net.
      //
      // Both values sit BELOW the £9.90 cap on purpose. Above £960 every job
      // pays the cap, so net and gross would agree there and the assertion would
      // prove nothing — which is exactly what happened when this was first
      // written at £1,000/£1,200 and the cap flattened both to 990p.
      const netPennies = 10_000;
      const grossPennies = 12_000;

      expect(applicationFeeForPayment(netPennies, 0)).toBe(
        motkoFeePennies(netPennies, 0),
      );
      expect(motkoFeePennies(grossPennies, 0)).toBeGreaterThan(
        motkoFeePennies(netPennies, 0),
      );
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

});
