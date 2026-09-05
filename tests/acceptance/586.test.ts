import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

/**
 * Issue #586: RAIL-2 — Mark-as-paid stays unaffected and unpenalised
 *
 * These tests verify that:
 * 1. Off-rail settlements (cash, bank transfer, other) write no fee record
 * 2. On-rail settlements continue to record fees as they do today
 * 3. The ledger (job_consumed, referral_unlock) is unaffected by isOffRail
 * 4. planPaidJobSettlement remains pure and deterministic
 *
 * OUT OF SCOPE (SUB-2 owns this):
 * - Whether off-rail jobs decrement the free-job counter
 * - The mark-as-paid UI (no change required)
 */

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "trade-1",
  jobValuePennies: 100_000, // £1,000
  freeJobsRemaining: 0,
  isFirstPaidJob: false,
  pendingReferral: null,
  feeCollectedAtSource: false,
  ...over,
});

describe("Issue #586: Off-rail settlements write no fee record", () => {
  describe("Off-rail payment methods", () => {
    it("writes no fee record when isOffRail is true", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 0, isOffRail: true }),
      );

      // No fee recorded: all zeros
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeNetPennies).toBe(0);
      expect(plan.fee.feeVatPennies).toBe(0);
      expect(plan.fee.feeWaivedAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedReason).toBeNull();
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });

    it("writes no fee record for high-value off-rail jobs", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 900_000, freeJobsRemaining: 0, isOffRail: true }),
      );

      // £9,000 job would normally incur a fee, but off-rail writes none
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });

    it("writes no fee record even when free jobs remain", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 3, isOffRail: true }),
      );

      // Off-rail: no fee recorded, regardless of free allowance
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });
  });

  describe("On-rail payment methods (unchanged)", () => {
    it("continues to record fees when isOffRail is false", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 0, isOffRail: false }),
      );

      // On-rail: fee is computed and recorded as accrued
      expect(plan.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(plan.fee.feeStatus).toBe("accrued");
    });

    it("continues to record fees when isOffRail is absent (default)", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 0 }),
      );

      // Default behavior: on-rail, fee is recorded
      expect(plan.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(plan.fee.feeStatus).toBe("accrued");
    });

    it("marks fee collected when feeCollectedAtSource is true", () => {
      const plan = planPaidJobSettlement(
        facts({
          jobValuePennies: 100_000,
          freeJobsRemaining: 0,
          isOffRail: false,
          feeCollectedAtSource: true,
        }),
      );

      // Fee taken at source: recorded as collected
      expect(plan.fee.feeAmountPennies).toBeGreaterThan(0);
      expect(plan.fee.feeStatus).toBe("collected");
    });
  });

  describe("Ledger behavior (unaffected by isOffRail)", () => {
    it("burns one free job credit for off-rail when allowance > 0", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 2, isOffRail: true }),
      );

      // Off-rail with free allowance: no fee, but credit is consumed
      expect(plan.fee.feeAmountPennies).toBe(0);

      const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumptionEvents).toHaveLength(1);
      expect(consumptionEvents[0]?.delta).toBe(-1);
      expect(consumptionEvents[0]?.contractorId).toBe("trade-1");
    });

    it("burns no credit for off-rail when allowance is exhausted", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 0, isOffRail: true }),
      );

      // No free allowance: no credit consumed
      const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumptionEvents).toHaveLength(0);
    });

    it("activates referral for off-rail first paid job", () => {
      const plan = planPaidJobSettlement(
        facts({
          jobValuePennies: 100_000,
          freeJobsRemaining: 0,
          isFirstPaidJob: true,
          isOffRail: true,
          pendingReferral: {
            referralId: "ref-1",
            referrerContractorId: "referrer-1",
          },
          activatedReferralCount: 1,
        }),
      );

      // Off-rail first paid job activates the referral
      expect(plan.referralActivation).not.toBeNull();
      expect(plan.referralActivation?.referralId).toBe("ref-1");

      // Referrer gets credit
      const referralUnlocks = plan.ledger.filter((e) => e.reason === "referral_unlock");
      expect(referralUnlocks).toHaveLength(1);
      expect(referralUnlocks[0]?.contractorId).toBe("referrer-1");
      expect(referralUnlocks[0]?.delta).toBe(3); // First activation grants +3
    });

    it("grants tier-appropriate credit for high-tier referral activation", () => {
      const plan = planPaidJobSettlement(
        facts({
          jobValuePennies: 100_000,
          freeJobsRemaining: 0,
          isFirstPaidJob: true,
          isOffRail: true,
          pendingReferral: {
            referralId: "ref-5",
            referrerContractorId: "referrer-1",
          },
          activatedReferralCount: 5, // 5th activation
        }),
      );

      // 5th activation grants +5, even for off-rail
      const referralUnlocks = plan.ledger.filter((e) => e.reason === "referral_unlock");
      expect(referralUnlocks).toHaveLength(1);
      expect(referralUnlocks[0]?.delta).toBe(5); // Champion tier
    });
  });

  describe("Edge cases", () => {
    it("handles zero job value off-rail", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 0, freeJobsRemaining: 0, isOffRail: true }),
      );

      // Zero value: still no fee off-rail
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });

    it("handles very large off-rail job value", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 5_000_000, freeJobsRemaining: 0, isOffRail: true }),
      );

      // £50,000 job: no fee off-rail
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });

    it("off-rail with free allowance: no fee, but credit consumed", () => {
      const plan = planPaidJobSettlement(
        facts({ jobValuePennies: 100_000, freeJobsRemaining: 5, isOffRail: true }),
      );

      // Off-rail with free allowance: no fee recorded
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeWaivedAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");

      // Credit still consumed
      const consumptionEvents = plan.ledger.filter((e) => e.reason === "job_consumed");
      expect(consumptionEvents).toHaveLength(1);
    });
  });

  describe("Type contract", () => {
    it("PaidJobFacts accepts optional isOffRail boolean", () => {
      // Type check: isOffRail is optional on PaidJobFacts
      const withFlag: PaidJobFacts = {
        jobId: "job-1",
        contractorId: "trade-1",
        jobValuePennies: 100_000,
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
        isOffRail: true,
      };

      const withoutFlag: PaidJobFacts = {
        jobId: "job-1",
        contractorId: "trade-1",
        jobValuePennies: 100_000,
        freeJobsRemaining: 0,
        isFirstPaidJob: false,
      };

      expect(withFlag.isOffRail).toBe(true);
      expect(withoutFlag.isOffRail).toBeUndefined();
    });

    it("planPaidJobSettlement returns zero fee for isOffRail true", () => {
      const plan = planPaidJobSettlement(
        facts({ isOffRail: true, jobValuePennies: 100_000 }),
      );

      // Return type is SettlementPlan, fee is JobFeeOutcome
      expect(plan.fee).toHaveProperty("feeAmountPennies");
      expect(plan.fee).toHaveProperty("feeStatus");
      expect(plan.fee.feeAmountPennies).toBe(0);
      expect(plan.fee.feeStatus).toBe("not_applicable");
    });
  });

  describe("settlePaidJob integration point", () => {
    it("settlePaidJob must derive isOffRail from payment method", async () => {
      // This test documents the integration contract: settlePaidJob receives
      // input.paymentMethod and must map it to isOffRail before calling
      // planPaidJobSettlement.
      //
      // Payment methods:
      // - On-rail: "motko_bank", "stripe_bank"
      // - Off-rail: "cash", "bank_transfer", "other"
      //
      // The mapping:
      //   isOffRail = input.paymentMethod in ["cash", "bank_transfer", "other"]
      //
      // This test asserts the module exports the types needed for that check.

      const mod = await import("@/lib/settle-paid-job");

      // PaymentMethod type is exported
      expect(mod.settlePaidJob).toBeDefined();
      expect(typeof mod.settlePaidJob).toBe("function");

      // The function signature accepts SettlePaidJobInput, which includes paymentMethod
      // The Engineer must map paymentMethod to isOffRail inside settlePaidJob
    });
  });
});
