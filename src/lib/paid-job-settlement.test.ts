import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

const facts = (over: Partial<PaidJobFacts> = {}): PaidJobFacts => ({
  jobId: "job-1",
  contractorId: "trade-1",
  jobValuePennies: 50_000,
  freeJobsRemaining: 5,
  isFirstPaidJob: false,
  pendingReferral: null,
  ...over,
});

describe("planPaidJobSettlement — fee outcome", () => {
  it("waives the fee and burns a free job while allowance remains", () => {
    const plan = planPaidJobSettlement(facts({ freeJobsRemaining: 5 }));
    expect(plan.fee).toEqual({
      feeAmountPennies: 0,
      feeWaivedReason: "free_allowance",
      feeStatus: "not_applicable",
    });
    expect(plan.ledger).toEqual([
      {
        contractorId: "trade-1",
        delta: -1,
        reason: "job_consumed",
        relatedJobId: "job-1",
        relatedReferralId: null,
      },
    ]);
  });

  it("accrues £2 for a small job once the allowance is exhausted", () => {
    const plan = planPaidJobSettlement(facts({ freeJobsRemaining: 0, jobValuePennies: 100_000 }));
    expect(plan.fee).toEqual({
      feeAmountPennies: 200,
      feeWaivedReason: null,
      feeStatus: "accrued",
    });
    // No free job to burn once the allowance is gone.
    expect(plan.ledger).toEqual([]);
  });

  it("accrues £4 (the cap) for a large job once the allowance is exhausted", () => {
    const plan = planPaidJobSettlement(facts({ freeJobsRemaining: 0, jobValuePennies: 5_000_000 }));
    expect(plan.fee.feeAmountPennies).toBe(400);
    expect(plan.fee.feeStatus).toBe("accrued");
  });
});

describe("planPaidJobSettlement — referral activation", () => {
  it("activates the referral and credits the referrer on the first paid job", () => {
    const plan = planPaidJobSettlement(
      facts({
        freeJobsRemaining: 5,
        isFirstPaidJob: true,
        pendingReferral: { referralId: "ref-1", referrerContractorId: "trade-2" },
      }),
    );
    expect(plan.referralActivation).toEqual({
      referralId: "ref-1",
      referrerContractorId: "trade-2",
    });
    // Referee burns their own free job; referrer gets +5 — two distinct trades.
    expect(plan.ledger).toEqual([
      {
        contractorId: "trade-1",
        delta: -1,
        reason: "job_consumed",
        relatedJobId: "job-1",
        relatedReferralId: null,
      },
      {
        contractorId: "trade-2",
        delta: 5,
        reason: "referral_unlock",
        relatedJobId: null,
        relatedReferralId: "ref-1",
      },
    ]);
  });

  it("still unlocks the referral when the first paid job accrued a fee (no free credit)", () => {
    const plan = planPaidJobSettlement(
      facts({
        freeJobsRemaining: 0,
        isFirstPaidJob: true,
        pendingReferral: { referralId: "ref-1", referrerContractorId: "trade-2" },
      }),
    );
    expect(plan.fee.feeStatus).toBe("accrued");
    expect(plan.referralActivation?.referrerContractorId).toBe("trade-2");
    // Only the referrer's unlock — no job_consumed since no allowance was used.
    expect(plan.ledger).toEqual([
      {
        contractorId: "trade-2",
        delta: 5,
        reason: "referral_unlock",
        relatedJobId: null,
        relatedReferralId: "ref-1",
      },
    ]);
  });

  it("does not activate when there is no pending referral", () => {
    const plan = planPaidJobSettlement(facts({ isFirstPaidJob: true, pendingReferral: null }));
    expect(plan.referralActivation).toBeNull();
  });

  it("does not activate on a later paid job even if a referral is pending", () => {
    const plan = planPaidJobSettlement(
      facts({
        isFirstPaidJob: false,
        pendingReferral: { referralId: "ref-1", referrerContractorId: "trade-2" },
      }),
    );
    expect(plan.referralActivation).toBeNull();
    expect(plan.ledger.every((e) => e.reason !== "referral_unlock")).toBe(true);
  });
});
