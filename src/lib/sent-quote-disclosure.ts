import { samePrice } from "@/lib/money-compare";

/**
 * A quote stays editable after it is sent (`EDITABLE_STATUSES` includes
 * "sent"), and that is deliberate — trades rely on correcting a quote without
 * starting a new one. What was missing is that the customer is never told.
 *
 * The two surfaces read different sources, which is what lets them diverge:
 * the SMS and email are built once from `quotes.total` at send and are frozen
 * from that moment; every renderer re-derives from `line_items_json` on each
 * request. So a customer can hold a text saying £114 and open a link saying
 * £20, with nothing anywhere acknowledging that both came from one business.
 *
 * `quotes.sent_total` (migration 051) records what was actually delivered.
 * This module is the single place that decides whether the two disagree, so
 * the public page and the editor can never reach different answers about the
 * same quote.
 */

export type SentQuoteDivergence = {
  /** What the customer was told at send. */
  sentTotal: number;
  /** What the quote says now. */
  currentTotal: number;
};

/**
 * Returns the divergence when a sent quote's live total no longer matches what
 * was delivered, or `null` when there is nothing to disclose.
 *
 * Null in three distinct cases, all of which mean "say nothing":
 *
 *  - **Never sent.** `sentTotal` is null for a draft. There is no customer
 *    copy to contradict, so there is nothing to disclose.
 *  - **Unchanged.** The figures agree to within a penny.
 *  - **Historic.** `sentTotal` is null on every quote sent before migration
 *    048 landed. Those quotes may well have diverged — the data to prove it
 *    was never recorded — and a notice must NOT be shown for them. Asserting
 *    "an earlier message quoted a different amount" on a quote we cannot check
 *    would be a fabrication shown to a customer, which is worse than the
 *    silence this ticket exists to fix.
 */
export const sentQuoteDivergence = (
  sentTotal: number | null | undefined,
  currentTotal: number,
): SentQuoteDivergence | null => {
  if (sentTotal == null) return null;
  if (samePrice(sentTotal, currentTotal)) return null;
  return { sentTotal, currentTotal };
};

/**
 * Whether an edit the contractor is about to make will produce a divergence
 * the customer would be shown — used to warn BEFORE the edit lands rather than
 * after, which is the only point at which the contractor can still decide to
 * re-send instead.
 */
export const editWillDiverge = (
  status: string,
  sentTotal: number | null | undefined,
  nextTotal: number,
): boolean => status === "sent" && sentQuoteDivergence(sentTotal, nextTotal) !== null;
