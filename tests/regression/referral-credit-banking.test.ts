// REF-3: Behavioural verification that planPaidJobSettlement populates credit
// banking fields on the fifth activation.
//
// This covers the half of the acceptance test at tests/acceptance/660.test.ts:34-55
// that froze before these assertions were added. See docs/specs/660.md lines 92-109
// for why this lives in regression rather than acceptance.

import { describe, expect, it } from "vitest";
import { planPaidJobSettlement, type PaidJobFacts } from "@/lib/paid-job-settlement";

describe("REF-3: Credit banking on fifth activation", () => {
  it("banks nothing on fourth activation", () => {
    const facts: PaidJobFacts = {
      jobId: "job_1",
      contractorId: "contractor_1",
      jobValuePennies: 50000,
      freeJobsRemaining: 5,
      isFirstPaidJob: true,
      pendingReferral: {
        referralId: "referral_1",
        referrerContractorId: "referrer_1",
      },
      activatedReferralCount: 4,
    };

    const plan = planPaidJobSettlement(facts);

    // Fourth activation grants referral_unlock but NO credit
    const unlockEntries = plan.ledger.filter((e) => e.reason === "referral_unlock");
    expect(unlockEntries.length).toBeGreaterThan(0);
    expect(plan.referralCreditsToBankForReferrer).toBe(0);
    expect(plan.referralCreditRecipient).toBeNull();
  });

  it("banks one credit on fifth activation alongside referral_unlock", () => {
    const facts: PaidJobFacts = {
      jobId: "job_1",
      contractorId: "contractor_1",
      jobValuePennies: 50000,
      freeJobsRemaining: 5,
      isFirstPaidJob: true,
      pendingReferral: {
        referralId: "referral_1",
        referrerContractorId: "referrer_1",
      },
      activatedReferralCount: 5,
    };

    const plan = planPaidJobSettlement(facts);

    // Fifth activation grants BOTH referral_unlock (existing) AND credit (new)
    const unlockEntries = plan.ledger.filter((e) => e.reason === "referral_unlock");
    expect(unlockEntries.length).toBeGreaterThan(0);

    // The credit banking fields must be populated
    expect(plan.referralCreditsToBankForReferrer).toBe(1);
    expect(plan.referralCreditRecipient).toBe("referrer_1");
  });

  it("banks second credit on tenth activation", () => {
    const facts: PaidJobFacts = {
      jobId: "job_1",
      contractorId: "contractor_1",
      jobValuePennies: 50000,
      freeJobsRemaining: 5,
      isFirstPaidJob: true,
      pendingReferral: {
        referralId: "referral_1",
        referrerContractorId: "referrer_1",
      },
      activatedReferralCount: 10,
    };

    const plan = planPaidJobSettlement(facts);

    // Tenth activation grants another credit (total is now 2, but this call grants 1)
    expect(plan.referralCreditsToBankForReferrer).toBe(1);
    expect(plan.referralCreditRecipient).toBe("referrer_1");
  });
});
