// Fee copy shown to the trade. Two lines live here: the forward-looking one on
// the mark-as-paid sheet ("what this will cost"), and the backward-looking one
// on a paid job ("what this did cost").
//
// Both are pure so the wording is asserted without rendering. Neither was
// reachable until fee visibility shipped — they sat behind FEE_BILLING_ENABLED,
// which meant a trade could be charged at source with nothing in the app
// explaining the deduction. The flag is gone; these always render now.
//
// App Store note, because the flag used to carry one: an earlier comment here
// described FEE_BILLING_ENABLED as "the App Store 3.1.2 guard", on the basis
// that a reviewed build had leaked fee copy. That account is self-defeating —
// if the copy leaked while the flag was off, the flag was not what guarded it —
// and no App Review correspondence in this repo supports or refutes it. Treat
// it as unverified rather than as precedent. The position of record is
// APP_STORE_CHECKLIST.md §6: the motko fee is a fee on physical services
// performed and consumed off-platform, not a digital good, so IAP does not
// apply. That box is still unticked; settle it against the actual review
// correspondence before the next submission.

import { formatGBP } from "@/lib/format";
import { FEE_STANDARD_PENNIES, motkoFeePennies } from "@/lib/motko-fee";

// The single line of fee / free-jobs copy shown in the mark-as-paid sheet.
// Forward-looking: this sheet is the trade marking an OFF-RAILS payment (cash,
// bank transfer), where no fee has been taken from anything yet.
// The fee is COMPUTED here, never banded. This line said "A £2 Motko fee
// applies" (or £4) long after FEE-6 replaced the flat bands with a marginal
// ladder, so the sheet quoted £4 on a £9,000 job whose fee is £23. The bands it
// named had not existed in the code for a week.
//
// A free job waives the service fee only up to the base-band cap, which is what
// `planPaidJobSettlement` does today — so the line says what is left to pay
// rather than "no fee", which would be false on any job above that. FEE-11
// removes the cap; when it does, this branch and /pricing change together.
/**
 * How much of the service fee one free-job credit waives.
 *
 * FEE-2's base-band cap, as `planPaidJobSettlement` applies it. Named here so
 * the copy and the settlement cannot state different numbers; FEE-11 is the
 * ticket that removes the cap, and it changes both.
 */
export const FREE_JOB_WAIVER_CAP_PENNIES = FEE_STANDARD_PENNIES;

export const markPaidFeeLine = (input: {
  freeJobsRemaining: number;
  quoteTotalPounds: number;
}): string => {
  const fullFee = motkoFeePennies(Math.round(input.quoteTotalPounds * 100), 0);

  if (input.freeJobsRemaining > 0) {
    const payable = Math.max(0, fullFee - FREE_JOB_WAIVER_CAP_PENNIES);
    if (payable === 0) return "This is one of your free jobs — no service fee.";
    return (
      `This is one of your free jobs. It covers ${formatGBP(FREE_JOB_WAIVER_CAP_PENNIES / 100)} ` +
      `of the ${formatGBP(fullFee / 100)} service fee, so ${formatGBP(payable / 100)} applies.`
    );
  }

  return `A ${formatGBP(fullFee / 100)} Motko service fee applies to this job.`;
};

// The job's STORED fee outcome, as written by settlement. Never recomputed
// here: the bands can change, and a job's fee is whatever was recorded against
// it at the moment it was paid.
export type PaidJobFeeFacts = {
  // jobs.fee_status — 'not_applicable' (free allowance), 'collected' (Stripe
  // took it out of the payment), or 'accrued' (a fee is recorded but nothing
  // took it). Null on jobs paid before the fee columns existed.
  feeStatus: string | null;
  // jobs.fee_amount_pennies — the fee charged. motko is not VAT registered, so
  // this is simply the fee; the stored net/VAT split describes it rather than
  // adding to it.
  feeAmountPennies: number | null;
  // jobs.fee_waived_reason — 'free_allowance' when the allowance covered it.
  feeWaivedReason: string | null;
  // The trade's free-job balance right now (after this job burned its credit).
  freeJobsRemaining: number;
};

// The fee line for a PAID job, or null when there is nothing truthful to say.
//
// Three outcomes:
//   • waived    — the allowance covered it. Say so, and what's left.
//   • collected — Stripe took the fee out of the payment. State the amount that
//                 actually left, from the stored value.
//   • accrued   — a fee is recorded against the job but nothing took it from
//                 this payment, and no rail currently collects it (PAY-5
//                 removed the rail; PAY-7 is the open decision on what happens
//                 to these). State the amount and its status, matching the
//                 wording the fees statement in Settings already uses.
//
// "Recorded, not charged" replaced "outstanding, not taken from this payment"
// on 2026-08-25, together with the same relabel in the Settings fee statement.
// "Outstanding" reads to a contractor as "you owe this", and nothing in the
// product collects it or is meant to — so the trade was reading a bill that
// will never arrive. The two surfaces are kept word-for-word in step by
// fee-copy.test.ts; changing one alone is how a trade ends up being told two
// different things about one fee. If the parked PAY-7 decision ever lands on
// collection, both change together and this comment is the place to start.
//
// The accrued line reports a state; it does not promise a collection. That
// distinction is what lets it be said at all. Saying NOTHING was the wrong
// alternative for two reasons: the mark-as-paid sheet has already told this
// trade "a £2 Motko fee applies to this job", so silence here contradicts a
// statement the same flow just made; and silence is only correct if PAY-7 lands
// on write-off. If PAY-7 lands on collection, every silent job becomes a
// surprise, and the fee is one the trade was told about at the time.
export const paidJobFeeLine = (facts: PaidJobFeeFacts): string | null => {
  if (facts.feeWaivedReason === "free_allowance") {
    const left = Math.max(0, facts.freeJobsRemaining);
    return `Paid in full. This was one of your free jobs — ${left} left.`;
  }

  const gross = facts.feeAmountPennies ?? 0;

  if (facts.feeStatus === "collected" && gross > 0) {
    return `Paid in full. Motko service fee ${formatGBP(gross / 100)} taken at payment.`;
  }

  if (facts.feeStatus === "accrued" && gross > 0) {
    return `Motko service fee ${formatGBP(gross / 100)} — recorded, not charged.`;
  }

  return null;
};
