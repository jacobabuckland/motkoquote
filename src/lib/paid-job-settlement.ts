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

import { motkoFeePennies, splitFeeVat } from "@/lib/motko-fee";

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
  // True when the fee was already taken out of THIS payment by Stripe, as an
  // application fee on the destination charge (PAY-4). Those jobs are settled
  // 'collected' the moment they are paid — there is nothing left to bill.
  //
  // Defaults to false, which is the legacy accrue-then-collect outcome: a fee is
  // owed and recorded as such. Callers that cannot know (manual "mark as paid",
  // where no Stripe payment exists) correctly leave it unset.
  feeCollectedAtSource?: boolean;
};

// Mirrors the jobs.fee_* columns from migrations 023 + 035. `feeStatus` is
// "not_applicable" when the free allowance covers the job (nothing to collect),
// "collected" when Stripe already took the fee out of the payment itself, and
// "accrued" when a real fee is owed and nothing has collected it yet.
// The fee is VAT-inclusive, so `feeAmountPennies` (gross) always equals
// `feeNetPennies + feeVatPennies` — the split is recorded, never added on top.
export type JobFeeOutcome = {
  feeAmountPennies: number;
  feeNetPennies: number;
  feeVatPennies: number;
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
};

export const planPaidJobSettlement = (facts: PaidJobFacts): SettlementPlan => {
  const usingFreeAllowance = facts.freeJobsRemaining > 0;

  // motkoFeePennies already waives (returns 0) while allowance remains, so the
  // two branches agree; we split them only to set the status/reason columns.
  let fee: JobFeeOutcome;
  if (usingFreeAllowance) {
    fee = {
      feeAmountPennies: 0,
      feeNetPennies: 0,
      feeVatPennies: 0,
      feeWaivedReason: "free_allowance",
      feeStatus: "not_applicable",
    };
  } else {
    const gross = motkoFeePennies(facts.jobValuePennies, facts.freeJobsRemaining);
    const split = splitFeeVat(gross);
    fee = {
      feeAmountPennies: gross,
      feeNetPennies: split.netPennies,
      feeVatPennies: split.vatPennies,
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
  let referralActivation: ReferralActivation = null;
  if (facts.isFirstPaidJob && facts.pendingReferral) {
    referralActivation = {
      referralId: facts.pendingReferral.referralId,
      referrerContractorId: facts.pendingReferral.referrerContractorId,
    };
    ledger.push({
      contractorId: facts.pendingReferral.referrerContractorId,
      delta: 5,
      reason: "referral_unlock",
      relatedJobId: null,
      relatedReferralId: facts.pendingReferral.referralId,
    });
  }

  return { fee, ledger, referralActivation };
};
