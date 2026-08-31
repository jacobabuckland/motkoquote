import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";
import { FEE_STANDARD_PENNIES } from "@/lib/motko-fee";

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

    // RETIRED by FEE-6: "handles the boundary case: exactly £1,000 job"
    // Superseded by marginal ladder (decision 31 Aug 2026)
  });

  // RETIRED by FEE-6: entire "Large jobs (> £1,000) with free credit — partial waiver" section
  // Superseded by marginal ladder (decision 31 Aug 2026)

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

    // RETIRED by FEE-6: "charges the full large-band fee with no waiver for large jobs"
    // Superseded by marginal ladder (decision 31 Aug 2026)
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

    // RETIRED by FEE-6: "sum of payable and waived equals the full computed fee"
    // Superseded by marginal ladder (decision 31 Aug 2026)

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
    // RETIRED by FEE-6: "calculates net and VAT from the payable amount, not the full or waived amount"
    // Superseded by marginal ladder (decision 31 Aug 2026)

    it("VAT split for a fully waived job is all zeros", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 50_000, freeJobsRemaining: 1 }),
      );

      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeNetPennies).toBe(0);
      expect(plan.fee.feeVatPennies).toBe(0);
    });

    // RETIRED by FEE-6: "VAT split for a full-price job (no credit) is based on full fee"
    // Superseded by marginal ladder (decision 31 Aug 2026)
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
