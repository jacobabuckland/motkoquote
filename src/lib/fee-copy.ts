// Fee copy shown to the trade. Two lines live here: the forward-looking one on
// the mark-as-paid sheet ("what this will cost"), and the backward-looking one
// on a paid job ("what this did cost").
//
// Both are pure so the wording is asserted without rendering. Neither was
// reachable until fee visibility shipped — they sat behind FEE_BILLING_ENABLED,
// which meant a trade could be charged at source with nothing in the app
// explaining the deduction. The flag is gone; these always render now.

import { formatGBP } from "@/lib/format";

// The single line of fee / free-jobs copy shown in the mark-as-paid sheet.
// Forward-looking: this sheet is the trade marking an OFF-RAILS payment (cash,
// bank transfer), where no fee has been taken from anything yet.
export const markPaidFeeLine = (input: {
  freeJobsRemaining: number;
  quoteTotalPounds: number;
}): string => {
  if (input.freeJobsRemaining > 0) return "This is one of your free jobs — no fee.";
  const band = input.quoteTotalPounds <= 1000 ? 2 : 4;
  return `A £${band} Motko fee applies to this job.`;
};

// The job's STORED fee outcome, as written by settlement. Never recomputed
// here: the bands can change, and a job's fee is whatever was recorded against
// it at the moment it was paid.
export type PaidJobFeeFacts = {
  // jobs.fee_status — 'not_applicable' (free allowance), 'collected' (Stripe
  // took it out of the payment), or 'accrued' (a fee is recorded but nothing
  // took it). Null on jobs paid before the fee columns existed.
  feeStatus: string | null;
  // jobs.fee_amount_pennies — the gross, VAT-inclusive fee.
  feeAmountPennies: number | null;
  // jobs.fee_waived_reason — 'free_allowance' when the allowance covered it.
  feeWaivedReason: string | null;
  // The trade's free-job balance right now (after this job burned its credit).
  freeJobsRemaining: number;
};

// The fee line for a PAID job, or null when there is nothing truthful to say.
//
// Three outcomes, and the third is the careful one:
//   • waived    — the allowance covered it. Say so, and what's left.
//   • collected — Stripe took the fee out of the payment. State the amount that
//                 actually left, from the stored value.
//   • accrued   — a fee is recorded against the job but NOTHING took it and
//                 nothing collects it (PAY-5 removed the rail; PAY-7 is the
//                 open decision about what to do with these). Returning null is
//                 deliberate: "taken at payment" would be false, and "we'll
//                 collect it" would be a promise the product cannot keep. The
//                 amount is still visible in Settings → Motko fees, under
//                 "Outstanding — not taken at source", which is where an
//                 unresolved balance belongs.
export const paidJobFeeLine = (facts: PaidJobFeeFacts): string | null => {
  if (facts.feeWaivedReason === "free_allowance") {
    const left = Math.max(0, facts.freeJobsRemaining);
    return `Paid in full. This was one of your free jobs — ${left} left.`;
  }

  if (facts.feeStatus === "collected" && (facts.feeAmountPennies ?? 0) > 0) {
    return `Paid in full. Motko fee ${formatGBP(
      (facts.feeAmountPennies ?? 0) / 100,
    )} (incl. VAT) taken at payment.`;
  }

  return null;
};
