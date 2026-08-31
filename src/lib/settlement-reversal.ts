// FEE-10 — what happens to a settlement's fees when the payment behind it is
// reversed.
//
// Stripe does not return its processing fee when a payment is refunded. Under
// the old model motko simply absorbed that. Under a pass-through model the
// question gets sharper: motko has charged the contractor for a processing cost
// Stripe has now kept, and charged a service fee for work that has been undone.
// Without an explicit rule a refunded £5,000 job leaves motko £5 down and the
// contractor with an unexplained deduction on a payment that no longer exists.
//
// The card's own note is the reason this file is mostly rules and comments:
// "This is a small ticket with a disproportionate trust cost if it is
// discovered rather than disclosed. The clause matters more than the code."
// So the rules live here, the contractor terms state them in the same words,
// and `tests/regression/settlement-reversal.test.ts` holds the two together —
// a non-refundable fee that is not written down is not enforceable, and a
// clause the code contradicts is worse than no clause.
//
// SCOPE. This module decides what a reversal does to the fee columns. It does
// NOT perform a reversal: there is no refund path in the product, by design —
// FEE-10 is explicitly "a ledger and terms change" with any refund UI out of
// scope. When one is built it calls `planSettlementReversal` rather than
// deciding for itself.

/** The fee state of a settlement, as stored on the job. */
export interface SettlementFees {
  /** jobs.fee_amount_pennies — the motko service fee charged. */
  feeAmountPennies: number;
  /** jobs.fee_waived_amount_pennies — the portion a free credit covered. */
  feeWaivedAmountPennies: number;
  /** jobs.processing_fee_actual_pennies — Stripe's cost, passed through. */
  processingFeeActualPennies: number | null;
  /** True once a free-job credit has been burned against this job. */
  freeCreditConsumed: boolean;
}

export interface ReversalRequest {
  /** The settlement as it stands before the reversal. */
  fees: SettlementFees;
  /** How much of the customer payment is being returned, in pennies. */
  refundPennies: number;
  /** The full customer payment, in pennies. */
  paymentPennies: number;
  /**
   * Whether the settlement had completed when the reversal arrived.
   *
   * A payment reversed BEFORE settlement never had a fee charged against it, so
   * there is nothing to retain — and the card requires that case be
   * distinguishable from a post-settlement reversal rather than collapsed into
   * it. They look identical in the fee columns (both end at zero retained) and
   * mean completely different things: one is "no fee was ever due", the other
   * is "a fee was due, was charged, and is kept".
   */
  settled: boolean;
}

export interface ReversalPlan {
  /** What the fee columns must read after the reversal. Unchanged, always. */
  fees: SettlementFees;
  /** The settlement state to record. */
  state: "reversed_after_settlement" | "reversed_before_settlement";
  /** True when the refund is for less than the whole payment. */
  partial: boolean;
  /** Fees motko keeps as a result — for the statement and the PNL. */
  retainedFeePennies: number;
  retainedProcessingPennies: number;
  /** Ledger entries to write. Empty: FEE-2's rule is that nothing is restored. */
  creditRestorations: never[];
}

/**
 * The reversal rules, in one place.
 *
 * Four properties, each of which is a published clause:
 *
 *   1. The service fee is non-refundable. The work motko did — the quote, the
 *      contract, the payment rail — happened whether or not the customer later
 *      cancelled.
 *   2. The processing fee is not returned, because Stripe keeps it. It is
 *      neither refunded to the contractor nor absorbed by motko.
 *   3. Fees are not pro-rated. A partial refund leaves the full fee standing.
 *   4. A consumed free-job credit is not restored (FEE-2's rule, unchanged).
 *
 * The function is total and returns the fees UNCHANGED in every branch. That is
 * the point rather than an oversight: the acceptance criterion is that
 * "refunding a settled payment leaves fee_amount_pennies and the processing
 * column unchanged", and a planner that cannot express a change to them cannot
 * be the thing that changes them.
 */
export function planSettlementReversal(request: ReversalRequest): ReversalPlan {
  const { fees, refundPennies, paymentPennies, settled } = request;

  // Rule 3, and it is checked rather than assumed. Pro-rating is the intuitive
  // behaviour and it is the wrong one, so `partial` exists to be reported in
  // the statement, never to scale a fee.
  const partial = refundPennies > 0 && refundPennies < paymentPennies;

  // A pre-settlement reversal never had a fee charged against it. Retaining
  // nothing is correct there and retaining the fee would be inventing a charge.
  const retainedFeePennies = settled ? fees.feeAmountPennies : 0;
  const retainedProcessingPennies = settled ? (fees.processingFeeActualPennies ?? 0) : 0;

  return {
    // Rules 1, 2 and 4: nothing about the stored settlement changes.
    fees: { ...fees },
    state: settled ? "reversed_after_settlement" : "reversed_before_settlement",
    partial,
    retainedFeePennies,
    retainedProcessingPennies,
    creditRestorations: [],
  };
}

/**
 * Whether a settlement's fee should count towards money still to come.
 *
 * A reversed settlement's fee has already been taken and is kept; it is not
 * revenue still to arrive. Counting it in the forward projection would report
 * the same money twice — once as collected, once as expected — which is the
 * double-count FEE-10's last acceptance criterion names.
 */
export function countsAsFutureRevenue(state: string | null): boolean {
  return state !== "reversed_after_settlement" && state !== "reversed_before_settlement";
}

/**
 * The clause, in the words the contractor terms use.
 *
 * Exported so the terms page and the fees statement cannot state it
 * differently, and so a test can assert the page says what the code does. Two
 * surfaces stating one rule in two wordings is how a contractor ends up
 * arguing about which one binds.
 */
export const REVERSAL_CLAUSE = {
  serviceFee:
    "The motko service fee is not refunded if a payment is later refunded or reversed. " +
    "The fee is charged for work that has already happened — preparing the quote, the " +
    "contract, and the payment itself — and that work is not undone by a refund.",
  partialRefund:
    "Fees are not reduced in proportion to a partial refund. If part of a payment is " +
    "refunded, the full fee on that payment still stands.",
  freeCredit:
    "A free job credit used on a payment is not returned if that payment is refunded.",
} as const;
