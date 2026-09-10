import { describe, expect, it } from "vitest";
import {
  REFERRAL_CREDIT_EVERY,
  REFERRAL_REWARD_EARLY_FREE_JOBS,
  REFERRAL_REWARD_ESTABLISHED_FREE_JOBS,
  planReferralReward,
} from "@/lib/referral-reward";
import { MAX_BANKED_FREE_JOBS } from "@/lib/motko-fee";
import { planPaidJobSettlement } from "@/lib/paid-job-settlement";

/**
 * REF-4 moved referral activation from the referee's first PAID job to their
 * first SENT QUOTE.
 *
 * The reward RULES did not change — the tiering, the FEE-11 cap and the
 * every-fifth banked credit are the same. What changed is that they now have two
 * callers, so they were lifted into one shared pure function. These tests pin
 * the rules there, and pin that lifting them left `planPaidJobSettlement`
 * behaving exactly as its eight frozen acceptance files require.
 */

describe("what one activation is worth", () => {
  it("grants the early amount for the first four activations", () => {
    for (const activatedReferralCount of [1, 2, 3, 4]) {
      expect(planReferralReward({ activatedReferralCount }).grantedFreeJobs).toBe(
        REFERRAL_REWARD_EARLY_FREE_JOBS,
      );
    }
  });

  it("grants the established amount from the fifth onward", () => {
    for (const activatedReferralCount of [5, 6, 12]) {
      expect(planReferralReward({ activatedReferralCount }).grantedFreeJobs).toBe(
        REFERRAL_REWARD_ESTABLISHED_FREE_JOBS,
      );
    }
  });

  it("banks a credit on every fifth activation, and only then", () => {
    expect(planReferralReward({ activatedReferralCount: 4 }).banksCredit).toBe(false);
    expect(planReferralReward({ activatedReferralCount: 5 }).banksCredit).toBe(true);
    expect(planReferralReward({ activatedReferralCount: 9 }).banksCredit).toBe(false);
    expect(planReferralReward({ activatedReferralCount: 10 }).banksCredit).toBe(true);
  });

  it("banks a credit AND grants free jobs on the fifth — not one or the other", () => {
    const reward = planReferralReward({ activatedReferralCount: 5 });
    expect(reward.banksCredit).toBe(true);
    expect(reward.grantedFreeJobs).toBe(REFERRAL_REWARD_ESTABLISHED_FREE_JOBS);
  });
});

describe("the FEE-11 cap, which REF-4 is the first caller to actually feed", () => {
  it("truncates a grant to the room left under the cap", () => {
    // Two free jobs of room, an established-tier reward of five.
    const reward = planReferralReward({
      activatedReferralCount: 5,
      referrerFreeJobsRemaining: MAX_BANKED_FREE_JOBS - 2,
    });
    expect(reward.grantedFreeJobs).toBe(2);
  });

  it("still activates and still banks the credit when the grant truncates to zero", () => {
    // Truncated, never refused: the referral activated and the referrer keeps
    // whatever else they earned.
    const reward = planReferralReward({
      activatedReferralCount: 5,
      referrerFreeJobsRemaining: MAX_BANKED_FREE_JOBS,
    });
    expect(reward.grantedFreeJobs).toBe(0);
    expect(reward.banksCredit).toBe(true);
  });

  it("never emits a negative grant for a balance already over the cap", () => {
    // A negative delta would claw back credits the contractor holds. The cap
    // bounds what can be ACCUMULATED, not what is held.
    expect(
      planReferralReward({
        activatedReferralCount: 5,
        referrerFreeJobsRemaining: MAX_BANKED_FREE_JOBS + 4,
      }).grantedFreeJobs,
    ).toBe(0);
  });

  it("grants in full when the balance is unknown", () => {
    // Silently truncating on a figure the caller did not supply would drop a
    // real reward on incomplete information. This is the paid path's behaviour
    // today, which supplies no balance at all.
    expect(planReferralReward({ activatedReferralCount: 5 }).grantedFreeJobs).toBe(
      REFERRAL_REWARD_ESTABLISHED_FREE_JOBS,
    );
  });
});

describe("lifting the rules out left the settlement planner unchanged", () => {
  const facts = (over: Partial<Parameters<typeof planPaidJobSettlement>[0]> = {}) => ({
    jobId: "job_1",
    contractorId: "ctr_referee",
    jobValuePennies: 100_000,
    freeJobsRemaining: 0,
    isFirstPaidJob: true,
    pendingReferral: { referralId: "ref_1", referrerContractorId: "ctr_referrer" },
    activatedReferralCount: 1,
    feeCollectedAtSource: false,
    isOffRail: false,
    ...over,
  });

  it("still emits a referral_unlock for the referrer on a first paid job", () => {
    const plan = planPaidJobSettlement(facts());
    const unlock = plan.ledger.find((e) => e.reason === "referral_unlock");

    expect(unlock).toBeDefined();
    expect(unlock?.contractorId).toBe("ctr_referrer");
    expect(unlock?.delta).toBe(REFERRAL_REWARD_EARLY_FREE_JOBS);
    expect(unlock?.relatedReferralId).toBe("ref_1");
  });

  it("still banks a credit for the referrer on their fifth", () => {
    const plan = planPaidJobSettlement(facts({ activatedReferralCount: REFERRAL_CREDIT_EVERY }));

    expect(plan.referralCreditsToBankForReferrer).toBe(1);
    expect(plan.referralCreditRecipient).toBe("ctr_referrer");
  });

  it("still does nothing when there is no pending referral", () => {
    // Which is the state REF-4 leaves it in: a quote already activated the
    // referral, so by the time the first paid job settles there is none pending
    // and the paid path cannot grant a second time.
    const plan = planPaidJobSettlement(facts({ pendingReferral: null }));

    expect(plan.ledger.find((e) => e.reason === "referral_unlock")).toBeUndefined();
    expect(plan.referralActivation).toBeNull();
    expect(plan.referralCreditsToBankForReferrer).toBe(0);
  });
});
