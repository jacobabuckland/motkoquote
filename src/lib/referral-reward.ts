import { MAX_BANKED_FREE_JOBS } from "@/lib/motko-fee";

/**
 * What one referral activation is worth. ONE function, called by both triggers.
 *
 * These rules used to live inline inside `planPaidJobSettlement`, which was fine
 * while the paid job was the only thing that could activate a referral. REF-4
 * moves the trigger to the referee's first sent quote, so a second caller
 * appeared — and a second copy of the tiering, the cap and the every-fifth
 * credit rule would be exactly the drift AGENTS.md records twice already: FEE-9,
 * where the app told a contractor one thing and settlement did another, and
 * FEE-11, where the waiver ceiling was named separately in two modules.
 *
 * Pure and I/O-free, so both paths are testable without a database.
 */

/** Activations 1-4. */
export const REFERRAL_REWARD_EARLY_FREE_JOBS = 3;

/** Activations 5 and beyond. */
export const REFERRAL_REWARD_ESTABLISHED_FREE_JOBS = 5;

/** One banked credit every Nth activation. REF-3. */
export const REFERRAL_CREDIT_EVERY = 5;

export type ReferralRewardInput = {
  /**
   * The referrer's activated count AFTER incrementing for this activation, so
   * the fifth activation sees 5. Undefined from legacy callers, which is
   * treated as an established referrer — see the tier note below.
   */
  activatedReferralCount?: number;
  /**
   * The referrer's current free-job balance. Undefined means the caller did not
   * supply it, and the grant is NOT truncated in that case.
   */
  referrerFreeJobsRemaining?: number;
};

export type ReferralReward = {
  /** Free jobs to credit the referrer. Zero is possible, and means grant nothing. */
  grantedFreeJobs: number;
  /** Whether this activation also banks a referral credit (a month of access). */
  banksCredit: boolean;
};

export const planReferralReward = (input: ReferralRewardInput): ReferralReward => {
  // Tier: activations 1-4 grant 3, activations 5+ grant 5. An undefined count
  // defaults to the established tier for backward compatibility with callers
  // that predate the counter.
  const activatedCount = input.activatedReferralCount;
  const rewardAmount =
    activatedCount !== undefined && activatedCount < REFERRAL_CREDIT_EVERY
      ? REFERRAL_REWARD_EARLY_FREE_JOBS
      : REFERRAL_REWARD_ESTABLISHED_FREE_JOBS;

  // FEE-11: a grant may not take the referrer above MAX_BANKED_FREE_JOBS.
  //
  // Truncated to the room remaining, not refused: the referral still activates
  // and the referrer still banks whatever fits. Refusing outright would
  // silently drop a reward somebody earned.
  //
  // A balance ALREADY above the cap keeps it and is spent down — `room` goes
  // negative there, and Math.max pins the grant to zero rather than emitting a
  // negative delta, which would claw back credits the contractor holds. The cap
  // bounds what can be ACCUMULATED, not what is held.
  //
  // An unknown referrer balance grants in full. Silently truncating on a figure
  // the caller did not supply would be worse than the leak: it drops a real
  // reward on incomplete information.
  //
  // NOTE, and it is a live gap rather than a hypothetical: no caller supplied
  // this until REF-4. `settle-paid-job.ts` never passed it, so the cap has been
  // inert on the paid-job path since FEE-11 shipped and every referral there
  // granted in full. REF-4's quote path DOES pass it, so the recorded decision
  // (Jacob, 1 Sep, cap of 10) finally binds on the trigger that is now live.
  const referrerBalance = input.referrerFreeJobsRemaining;
  const room =
    referrerBalance === undefined
      ? rewardAmount
      : Math.max(0, MAX_BANKED_FREE_JOBS - referrerBalance);

  return {
    grantedFreeJobs: Math.min(rewardAmount, room),
    // REF-3: bank a credit on every 5th activation. Credits accumulate without
    // cap, unlike free jobs, and banking does NOT replace the free-job grant —
    // both fire on the fifth.
    banksCredit:
      activatedCount !== undefined &&
      activatedCount > 0 &&
      activatedCount % REFERRAL_CREDIT_EVERY === 0,
  };
};
