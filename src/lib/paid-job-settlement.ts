// Pure settlement planner — decides every ledger effect of a paid job.
//
// When a pay-by-bank payment executes, exactly one job becomes "paid". This
// module turns the facts about that job (its value, the trade's remaining free
// allowance, whether it's their first ever paid job, and any pending referral)
// into the complete, deterministic set of effects: the job's fee outcome, the
// append-only `credit_events` to write, and whether a referral activates.
//
// Kept pure and I/O-free so the money-affecting logic is unit-tested in
// isolation; the webhook handler loads the facts, calls this, then applies the
// plan with the service-role client (see fee_collections / credit_events).

import { motkoFeePennies, splitFeeVat, FEE_STANDARD_PENNIES } from "@/lib/motko-fee";

// A pending referral in which THIS trade is the referee. Landing their first
// paid job unlocks the reward for the referrer named here.
export type PendingReferral = {
  referralId: string;
  referrerContractorId: string;
};

export type PaidJobFacts = {
  jobId: string;
  // The trade whose job was paid (the "referee" in referral terms).
  contractorId: string;
  jobValuePennies: number;
  // The trade's cached free allowance BEFORE this settlement is applied.
  freeJobsRemaining: number;
  // True only for the trade's first-ever paid job — the referral trigger.
  isFirstPaidJob: boolean;
  // A still-pending referral where this trade is the referee, or null.
  pendingReferral?: PendingReferral | null;
  // The referrer's activated_referral_count AFTER incrementing for this activation.
  // Used to determine the tier: activations 1-4 grant +3, activations 5+ grant +5.
  activatedReferralCount?: number;
  // True when the fee was already taken out of THIS payment by Stripe, as an
  // application fee on the destination charge (PAY-4). Those jobs are settled
  // 'collected' the moment they are paid — there is nothing left to bill.
  //
  // Defaults to false, which is the legacy accrue-then-collect outcome: a fee is
  // owed and recorded as such. Callers that cannot know (manual "mark as paid",
  // where no Stripe payment exists) correctly leave it unset.
  feeCollectedAtSource?: boolean;
  // FEE-7: Stripe processing fee fields (estimated, actual, delta).
  // All three are null for off-rail payments (manual mark-as-paid).
  processingFeeEstimatedPennies?: number | null;
  processingFeeActualPennies?: number | null;
  processingFeeDeltaPennies?: number | null;
};

// Mirrors the jobs.fee_* columns from migrations 023 + 035 + 046. `feeStatus` is
// "not_applicable" when the free allowance covers the job (nothing to collect),
// "collected" when Stripe already took the fee out of the payment itself, and
// "accrued" when a real fee is owed and nothing has collected it yet.
// The fee is VAT-inclusive, so `feeAmountPennies` (gross) always equals
// `feeNetPennies + feeVatPennies` — the split is recorded, never added on top.
//
// FEE-2: `feeAmountPennies` is the payable amount (what's actually charged).
// `feeWaivedAmountPennies` is the portion waived by a free credit (capped at
// the base-band fee). The sum equals the full computed band fee for that job.
export type JobFeeOutcome = {
  feeAmountPennies: number;
  feeNetPennies: number;
  feeVatPennies: number;
  feeWaivedAmountPennies: number;
  feeWaivedReason: "free_allowance" | null;
  feeStatus: "not_applicable" | "accrued" | "collected";
};

// One append-only row for `credit_events`. `job_consumed` (-1) burns a free job
// off the referee's allowance; `referral_unlock` (+5) rewards the referrer.
export type LedgerEntry = {
  contractorId: string;
  delta: number;
  reason: "job_consumed" | "referral_unlock";
  relatedJobId: string | null;
  relatedReferralId: string | null;
};

export type ReferralActivation = {
  referralId: string;
  referrerContractorId: string;
} | null;

export type SettlementPlan = {
  fee: JobFeeOutcome;
  ledger: LedgerEntry[];
  referralActivation: ReferralActivation;
  // FEE-7: Stripe processing fee fields passed through from facts
  processingFeeEstimatedPennies?: number | null;
  processingFeeActualPennies?: number | null;
  processingFeeDeltaPennies?: number | null;
};

export const planPaidJobSettlement = (facts: PaidJobFacts): SettlementPlan => {
  const usingFreeAllowance = facts.freeJobsRemaining > 0;

  // FEE-2: Compute the full banded fee first (regardless of free allowance), then
  // cap the waiver at FEE_STANDARD_PENNIES. The payable remainder is collected
  // through the same Stripe application-fee path.
  let fee: JobFeeOutcome;
  if (usingFreeAllowance) {
    // Full fee for the job, as if no credit were used
    const fullFee = motkoFeePennies(facts.jobValuePennies, 0);
    // Waive up to the base-band fee
    const waivedAmount = Math.min(fullFee, FEE_STANDARD_PENNIES);
    // Charge the remainder
    const payableAmount = fullFee - waivedAmount;
    // VAT split is computed from the payable amount only
    const split = splitFeeVat(payableAmount);

    fee = {
      feeAmountPennies: payableAmount,
      feeNetPennies: split.netPennies,
      feeVatPennies: split.vatPennies,
      feeWaivedAmountPennies: waivedAmount,
      feeWaivedReason: "free_allowance",
      // If nothing is payable after the waiver, it's 'not_applicable'.
      // If a remainder is owed and was collected at source, 'collected'.
      // Otherwise 'accrued'.
      feeStatus:
        payableAmount === 0
          ? "not_applicable"
          : facts.feeCollectedAtSource
            ? "collected"
            : "accrued",
    };
  } else {
    const gross = motkoFeePennies(facts.jobValuePennies, facts.freeJobsRemaining);
    const split = splitFeeVat(gross);
    fee = {
      feeAmountPennies: gross,
      feeNetPennies: split.netPennies,
      feeVatPennies: split.vatPennies,
      feeWaivedAmountPennies: 0,
      feeWaivedReason: null,
      // Taken at source => nothing is owed, so it is never part of any "to
      // collect" total. Anything else stays 'accrued'.
      feeStatus: facts.feeCollectedAtSource ? "collected" : "accrued",
    };
  }

  const ledger: LedgerEntry[] = [];

  // Burn one free job only when the allowance actually covered this job.
  if (usingFreeAllowance) {
    ledger.push({
      contractorId: facts.contractorId,
      delta: -1,
      reason: "job_consumed",
      relatedJobId: facts.jobId,
      relatedReferralId: null,
    });
  }

  // The referral reward fires on the referee's first paid job regardless of
  // whether that job used the free allowance or accrued a fee — and it credits
  // the referrer, never the referee.
  // Tier: activations 1-4 grant +3, activations 5+ grant +5.
  let referralActivation: ReferralActivation = null;
  if (facts.isFirstPaidJob && facts.pendingReferral) {
    referralActivation = {
      referralId: facts.pendingReferral.referralId,
      referrerContractorId: facts.pendingReferral.referrerContractorId,
    };

    // Determine the reward amount based on the referrer's activated count.
    // The count passed in is AFTER incrementing, so the 5th activation sees count=5.
    // When undefined (legacy callers), default to 5 for backward compatibility.
    const activatedCount = facts.activatedReferralCount;
    const rewardAmount = activatedCount !== undefined && activatedCount < 5 ? 3 : 5;

    ledger.push({
      contractorId: facts.pendingReferral.referrerContractorId,
      delta: rewardAmount,
      reason: "referral_unlock",
      relatedJobId: null,
      relatedReferralId: facts.pendingReferral.referralId,
    });
  }

  return {
    fee,
    ledger,
    referralActivation,
    // FEE-7: Pass through processing fee fields from facts
    processingFeeEstimatedPennies: facts.processingFeeEstimatedPennies,
    processingFeeActualPennies: facts.processingFeeActualPennies,
    processingFeeDeltaPennies: facts.processingFeeDeltaPennies,
  };
};
