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

import {
  MAX_BANKED_FREE_JOBS,
  feeWouldSwallowPayment,
  motkoFeePennies,
  splitFeeVat,
  waiverSplit,
} from "@/lib/motko-fee";

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
  // The REFERRER's banked balance before this grant (FEE-11's cap).
  //
  // Optional, and undefined means "grant in full" rather than "assume zero".
  // Assuming zero would be the same shape of lie as the four-table PII notice:
  // a value the caller never supplied, read as if it had been.
  referrerFreeJobsRemaining?: number;
  // True when the fee was already taken out of THIS payment by Stripe, as an
  // application fee on the destination charge (PAY-4). Those jobs are settled
  // 'collected' the moment they are paid — there is nothing left to bill.
  //
  // Defaults to false, which is the legacy accrue-then-collect outcome: a fee is
  // owed and recorded as such. Callers that cannot know (manual "mark as paid",
  // where no Stripe payment exists) correctly leave it unset.
  feeCollectedAtSource?: boolean;
  // Stripe's `application_fee_amount` on the settled charge, in pennies.
  //
  // THE FEE ACTUALLY TAKEN, not a prediction of it. `free_jobs_remaining` is
  // read once when the customer clicks Pay (to size the application fee) and
  // again here at settlement, with a bank-app redirect in between — so the two
  // reads can disagree, and recomputing the fee here can book a charge that
  // never happened or waive one that did. Recording what Stripe took is the
  // only value in the sequence that is a fact rather than a forecast.
  //
  // Decision 8 Sep 2026 (Jacob): reconcile at settlement rather than pinning
  // the allowance at intent creation — a reservation needs a TTL and a release
  // path, and an abandoned intent would hold a credit hostage. See
  // areas/motko.md.
  //
  // undefined means "the caller cannot know", NOT zero: off-rail settlements
  // and legacy callers leave it unset and keep the recompute path below.
  feeCollectedAtSourcePennies?: number;
  // True when the payment was made off-rail (cash, bank transfer, other). Off-rail
  // settlements write no fee record: there is no Stripe cost to recover. Defaults
  // to false, which is the legacy on-rail outcome: a fee is computed and recorded.
  isOffRail?: boolean;
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
  // REF-3: Credits to bank for the referrer on every 5th activation.
  // The caller creates rows in referral_credits for this contractor.
  referralCreditsToBankForReferrer: number;
  referralCreditRecipient: string | null;
};

export const planPaidJobSettlement = (facts: PaidJobFacts): SettlementPlan => {
  const usingFreeAllowance = facts.freeJobsRemaining > 0;

  // RAIL-2: Off-rail settlements (cash, bank transfer, other) write no fee
  // record. There is no Stripe cost for motko to recover, so recording a fee
  // was always wrong — it created a bill for money motko never spent.
  let fee: JobFeeOutcome;
  if (facts.isOffRail) {
    fee = {
      feeAmountPennies: 0,
      feeNetPennies: 0,
      feeVatPennies: 0,
      feeWaivedAmountPennies: 0,
      feeWaivedReason: null,
      feeStatus: "not_applicable",
    };
  } else if (facts.feeCollectedAtSourcePennies !== undefined) {
    // RECORD what Stripe took. Do not recompute it.
    //
    // Everything upstream of the settled charge is a prediction: the allowance
    // read at intent creation sized the application fee, and by the time the
    // webhook lands that read may be stale. `application_fee_amount` on the
    // settled charge is the one fact in the sequence, so it is what the job
    // records — the fee columns then describe money that actually moved.
    const collected = facts.feeCollectedAtSourcePennies;

    if (collected > 0) {
      const split = splitFeeVat(collected);
      fee = {
        feeAmountPennies: collected,
        feeNetPennies: split.netPennies,
        feeVatPennies: split.vatPennies,
        // Stripe charged, so nothing was waived — whatever the allowance says
        // now. Writing a waiver here is the failure that cannot be explained
        // to a trade: a record denying a charge they can see on their statement.
        feeWaivedAmountPennies: 0,
        feeWaivedReason: null,
        feeStatus: "collected",
      };
    } else {
      // Stripe took nothing, so nothing is owed — never 'accrued'. The two
      // reasons it can be zero are a free credit and a fee too small to fit
      // inside the payment; both leave the trade with nothing to pay.
      //
      // `usingFreeAllowance` is the allowance as it stands NOW, which is also
      // what governs the ledger burn below. When a credit was spent between
      // the two reads this reads false, so the job records a plain zero and
      // burns nothing — the counter lands a credit generous rather than going
      // negative. Accepted, deliberately, as the direction to err in.
      const waived = usingFreeAllowance ? motkoFeePennies(facts.jobValuePennies, 0) : 0;
      fee = {
        feeAmountPennies: 0,
        feeNetPennies: 0,
        feeVatPennies: 0,
        feeWaivedAmountPennies: waived,
        feeWaivedReason: usingFreeAllowance ? "free_allowance" : null,
        feeStatus: "not_applicable",
      };
    }
  } else if (usingFreeAllowance) {
    // FEE-2's split, with FEE-11's ceiling. The full ladder fee is computed first
    // regardless of the allowance, then the waiver is capped at
    // FREE_JOB_WAIVER_CEILING_PENNIES — unbounded since FEE-11, so payable is
    // always zero today. The arithmetic is kept rather than collapsed to
    // `waived = fullFee` for two reasons the card names: the persisted split
    // (full / waived / payable) stays honest, and reinstating a ceiling is a
    // config change rather than a rewrite of this branch.
    // Full fee for the job, as if no credit were used
    const fullFee = motkoFeePennies(facts.jobValuePennies, 0);
    const { waivedPennies: waivedAmount, payablePennies: payableAmount } = waiverSplit(fullFee);
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

    // SUB-3: a fee skipped because it would have swallowed the payment records
    // `not_applicable`, never `accrued`. The Stripe call site took nothing, so
    // there is nothing owed — booking it as accrued creates a debt the trade
    // never agreed to, and seven of the current quotes are small enough for this
    // path to be live rather than theoretical.
    //
    // Derived here from the same predicate the call site used, rather than read
    // off the payment: `feeCollectedAtSource` is false both when a fee was
    // skipped and when one is genuinely outstanding, so it cannot tell them
    // apart on its own.
    const skipped = feeWouldSwallowPayment(gross, facts.jobValuePennies);
    const payable = skipped ? 0 : gross;
    const split = splitFeeVat(payable);

    fee = {
      feeAmountPennies: payable,
      feeNetPennies: split.netPennies,
      feeVatPennies: split.vatPennies,
      feeWaivedAmountPennies: 0,
      feeWaivedReason: null,
      // Taken at source => nothing is owed, so it is never part of any "to
      // collect" total. Anything else stays 'accrued'.
      feeStatus: skipped
        ? "not_applicable"
        : facts.feeCollectedAtSource
          ? "collected"
          : "accrued",
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
  let referralCreditsToBankForReferrer = 0;
  let referralCreditRecipient: string | null = null;

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

    // FEE-11: a grant may not take the referrer above MAX_BANKED_FREE_JOBS.
    //
    // Truncated to the room remaining, not refused: the referral still
    // activates and the referrer still banks whatever fits. Refusing outright
    // would silently drop a reward somebody earned.
    //
    // A balance ALREADY above the cap keeps it and is spent down — `room` goes
    // negative there, and Math.max pins the grant to zero rather than emitting
    // a negative delta, which would claw back credits the contractor holds.
    // The cap bounds what can be accumulated, not what is held.
    //
    // An unknown referrer balance grants in full. Silently truncating on a
    // figure the caller did not supply would be worse than the leak: it drops
    // a real reward on incomplete information.
    const referrerBalance = facts.referrerFreeJobsRemaining;
    const room =
      referrerBalance === undefined
        ? rewardAmount
        : Math.max(0, MAX_BANKED_FREE_JOBS - referrerBalance);
    const grantedAmount = Math.min(rewardAmount, room);

    if (grantedAmount > 0) {
      ledger.push({
        contractorId: facts.pendingReferral.referrerContractorId,
        delta: grantedAmount,
        reason: "referral_unlock",
        relatedJobId: null,
        relatedReferralId: facts.pendingReferral.referralId,
      });
    }

    // REF-3: Bank a credit on every 5th activation. Credits accumulate without
    // cap (unlike free jobs). Banking does NOT replace referral_unlock — both
    // fire on the fifth activation.
    if (activatedCount !== undefined && activatedCount > 0 && activatedCount % 5 === 0) {
      referralCreditsToBankForReferrer = 1;
      referralCreditRecipient = facts.pendingReferral.referrerContractorId;
    }
  }

  return {
    fee,
    ledger,
    referralActivation,
    referralCreditsToBankForReferrer,
    referralCreditRecipient,
  };
};
