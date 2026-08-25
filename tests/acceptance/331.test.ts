import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";
import { FEE_STANDARD_PENNIES, FEE_LARGE_PENNIES, FEE_BAND_THRESHOLD_PENNIES } from "@/lib/motko-fee";

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "trade-1",
  jobValuePennies: 50_000,
  freeJobsRemaining: 0,
  isFirstPaidJob: false,
  pendingReferral: null,
  ...over,
});

describe("FEE-2: Cap what one free job can waive at the base band", () => {
  describe("Base band jobs (≤ £1,000) with free credit", () => {
    it("waives the full fee (£2) and charges nothing", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 50_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");
      expect(plan.fee.feeStatus).toBe("not_applicable");

      // One credit consumed
      expect(plan.ledger).toContainEqual(
        expect.objectContaining({
          contractorId: "trade-1",
          delta: -1,
          reason: "job_consumed",
        }),
      );
    });

    it("handles the boundary case: exactly £1,000 job", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: FEE_BAND_THRESHOLD_PENNIES, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);
    });
  });

  describe("Large jobs (> £1,000) with free credit — partial waiver", () => {
    it("waives the base-band fee (£2) and charges the remainder (£2)", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }), // £1,500 job
      );

      // Full fee is £4 (FEE_LARGE_PENNIES)
      // Waived: £2 (FEE_STANDARD_PENNIES)
      // Payable: £2 (£4 - £2)
      expect(plan.fee.feeAmountPennies).toBe(FEE_LARGE_PENNIES - FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");

      // Status is 'accrued' because there is a payable amount
      expect(plan.fee.feeStatus).toBe("accrued");

      // One credit consumed
      expect(plan.ledger).toContainEqual(
        expect.objectContaining({
          contractorId: "trade-1",
          delta: -1,
          reason: "job_consumed",
        }),
      );
    });

    it("handles the boundary case: one penny above £1,000", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: FEE_BAND_THRESHOLD_PENNIES + 1, freeJobsRemaining: 1 }),
      );

      // Full fee is £4
      // Waived: £2
      // Payable: £2
      expect(plan.fee.feeAmountPennies).toBe(FEE_LARGE_PENNIES - FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);
    });

    it("handles very large jobs: £50,000 job still caps waiver at base band", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 5_000_000, freeJobsRemaining: 1 }), // £50,000 job
      );

      // Full fee is £4 (capped)
      // Waived: £2 (base band)
      // Payable: £2
      expect(plan.fee.feeAmountPennies).toBe(FEE_LARGE_PENNIES - FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedReason).toBe("free_allowance");
    });

    it("marks as 'collected' when feeCollectedAtSource is true", () => {
      const plan = planPaidJobSettlement(
        facts({
          jobValuePennies: 150_000,
          freeJobsRemaining: 1,
          feeCollectedAtSource: true,
        }),
      );

      // Same waiver/payable split
      expect(plan.fee.feeAmountPennies).toBe(FEE_LARGE_PENNIES - FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(FEE_STANDARD_PENNIES);

      // But status is 'collected' instead of 'accrued'
      expect(plan.fee.feeStatus).toBe("collected");
    });
  });

  describe("Jobs without free credit — no waiver", () => {
    it("charges the full base-band fee with no waiver for small jobs", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 50_000, freeJobsRemaining: 0 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(FEE_STANDARD_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBeNull();
      expect(plan.fee.feeStatus).toBe("accrued");

      // No credit consumed
      expect(plan.ledger).not.toContainEqual(
        expect.objectContaining({ reason: "job_consumed" }),
      );
    });

    it("charges the full large-band fee with no waiver for large jobs", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 0 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(FEE_LARGE_PENNIES);
      expect(plan.fee.feeWaivedAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBeNull();
      expect(plan.fee.feeStatus).toBe("accrued");
    });
  });

  describe("Invariants and accounting properties", () => {
    it("waived amount never exceeds base-band fee", () => {
      const testCases = [
        { jobValuePennies: 10_000, freeJobsRemaining: 1 },
        { jobValuePennies: 100_000, freeJobsRemaining: 1 },
        { jobValuePennies: 150_000, freeJobsRemaining: 1 },
        { jobValuePennies: 5_000_000, freeJobsRemaining: 1 },
      ];

      for (const testCase of testCases) {
        const plan = planPaidJobSettlement(facts(testCase));
        expect(plan.fee.feeWaivedAmountPennies).toBeLessThanOrEqual(FEE_STANDARD_PENNIES);
      }
    });

    it("sum of payable and waived equals the full computed fee", () => {
      const testCases = [
        { jobValuePennies: 50_000, freeJobsRemaining: 1, expectedFull: FEE_STANDARD_PENNIES },
        { jobValuePennies: 100_000, freeJobsRemaining: 1, expectedFull: FEE_STANDARD_PENNIES },
        { jobValuePennies: 150_000, freeJobsRemaining: 1, expectedFull: FEE_LARGE_PENNIES },
        { jobValuePennies: 5_000_000, freeJobsRemaining: 1, expectedFull: FEE_LARGE_PENNIES },
      ];

      for (const { jobValuePennies, freeJobsRemaining, expectedFull } of testCases) {
        const plan = planPaidJobSettlement(facts({ jobValuePennies, freeJobsRemaining }));
        const total = plan.fee.feeAmountPennies + plan.fee.feeWaivedAmountPennies;
        expect(total).toBe(expectedFull);
      }
    });

    it("waived amount is never negative", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeWaivedAmountPennies).toBeGreaterThanOrEqual(0);
    });

    it("payable amount is never negative", () => {
      const testCases = [
        { jobValuePennies: 10_000, freeJobsRemaining: 1 },
        { jobValuePennies: 150_000, freeJobsRemaining: 1 },
      ];

      for (const testCase of testCases) {
        const plan = planPaidJobSettlement(facts(testCase));
        expect(plan.fee.feeAmountPennies).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("VAT split is computed from payable amount only", () => {
    it("calculates net and VAT from the payable amount, not the full or waived amount", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
      );

      // Payable is £2 (200 pennies)
      expect(plan.fee.feeAmountPennies).toBe(200);

      // VAT split should be based on £2, not £4
      // £2.00 → net £1.67, VAT £0.33
      expect(plan.fee.feeNetPennies).toBe(167);
      expect(plan.fee.feeVatPennies).toBe(33);

      // Invariant: net + vat = gross (payable)
      expect(plan.fee.feeNetPennies + plan.fee.feeVatPennies).toBe(plan.fee.feeAmountPennies);
    });

    it("VAT split for a fully waived job is all zeros", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 50_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeNetPennies).toBe(0);
      expect(plan.fee.feeVatPennies).toBe(0);
    });

    it("VAT split for a full-price job (no credit) is based on full fee", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 0 }),
      );

      // Payable is £4 (400 pennies)
      expect(plan.fee.feeAmountPennies).toBe(400);

      // £4.00 → net £3.33, VAT £0.67
      expect(plan.fee.feeNetPennies).toBe(333);
      expect(plan.fee.feeVatPennies).toBe(67);
      expect(plan.fee.feeNetPennies + plan.fee.feeVatPennies).toBe(400);
    });
  });

  describe("Credit consumption behavior", () => {
    it("consumes exactly one credit when waiver applies, regardless of payable remainder", () => {
      const testCases = [
        { jobValuePennies: 50_000, freeJobsRemaining: 5 },   // Full waiver
        { jobValuePennies: 150_000, freeJobsRemaining: 5 },  // Partial waiver
      ];

      for (const testCase of testCases) {
        const plan = planPaidJobSettlement(facts(testCase));
        const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
        expect(consumptionEvents).toHaveLength(1);
        expect(consumptionEvents[0]?.delta).toBe(-1);
      }
    });

    it("consumes no credit when allowance is already exhausted", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 0 }),
      );

      const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumptionEvents).toHaveLength(0);
    });
  });

  describe("Type signature change", () => {
    it("JobFeeOutcome includes feeWaivedAmountPennies field", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 150_000, freeJobsRemaining: 1 }),
      );

      // Type check: the field exists and is a number
      expect(plan.fee).toHaveProperty("feeWaivedAmountPennies");
      expect(typeof plan.fee.feeWaivedAmountPennies).toBe("number");
    });
  });
});
