import { formatGBP } from "@/lib/format";

/**
 * Money a customer has contractually agreed to that no invoice has asked for
 * yet.
 *
 * WHY THIS EXISTS. The dashboard's ledger figure — the largest thing in the
 * product — sums OPEN INVOICES. That is exactly right for "what am I waiting to
 * be paid", and it is silent about a different question with the same answer
 * shape: "what have I agreed and not yet billed".
 *
 * Reported 13 Sep. A £1,440 job took a 25% deposit, £360.00, which settled. The
 * remaining £1,080.00 had not been invoiced, so it was in no open invoice, so
 * the hero read:
 *
 *     You're all square
 *     Every invoice you've sent has been paid. Nothing outstanding.
 *
 * The first sentence was true. The second was not: £1,080 was contractually
 * owed and appeared on no screen in the app. It existed only on the PDF the
 * customer holds, which is the wrong way round — the person who is owed money
 * should not be the last to know.
 *
 * NOT A SECOND LEDGER FIGURE. An uninvoiced balance is not a receivable; the
 * customer has been asked for nothing and owes nothing yet. It belongs in the
 * zero state, as the reason the contractor is not actually finished, and it
 * must never be added to `outstandingTotal` — that would inflate the figure the
 * whole product is built around with money nobody has requested.
 */

export type BalanceQuote = {
  /** The quote's gross total — what the customer agreed to. */
  total: number;
  /** Every invoice raised against it, settled or not. */
  invoices: { amount: number }[];
  /** Whether a contract exists and is signed. */
  contractSigned: boolean;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * What this quote has agreed but not yet invoiced, or 0.
 *
 * Gated on a SIGNED contract, deliberately and narrowly. An accepted quote with
 * no contract is not yet money owed — decision (1) on #727 makes such a quote
 * still editable and still withdrawable, so calling it a balance would be
 * claiming something the customer has not committed to. A signed contract is
 * the point at which the figure becomes real.
 */
export const uninvoicedBalance = (quote: BalanceQuote): number => {
  if (!quote.contractSigned) return 0;
  const invoiced = round2(quote.invoices.reduce((sum, invoice) => sum + invoice.amount, 0));
  const balance = round2(quote.total - invoiced);
  // Negative means more has been invoiced than the quote totals — a variation
  // or a correction, and not this function's business. Never a negative
  // "balance", which would silently reduce another job's.
  return balance > 0 ? balance : 0;
};

/** The same, across every quote on the dashboard. */
export const totalUninvoicedBalance = (quotes: BalanceQuote[]): number =>
  round2(quotes.reduce((sum, quote) => sum + uninvoicedBalance(quote), 0));

/**
 * What the dashboard's "Unpaid invoices" panel says when no invoice is open.
 *
 * Lives here, beside the derivation, because the sentence is only correct in
 * terms of the figure — and keeping them apart is how the two surfaces drifted.
 * The hero learned about `uninvoicedTotal` on 13 Sep; this panel kept claiming
 * "Every invoice you've sent has been paid." full stop, which reads as "you are
 * all square" a few inches below three cards telling the contractor to raise
 * the final invoice. Reported 18 Sep.
 *
 * Both sentences stand together where there is a balance. Every invoice IS
 * paid — that half was never wrong, and dropping it would trade one
 * misstatement for another.
 */
export const unpaidInvoicesEmptyDescription = (uninvoicedTotal: number): string =>
  uninvoicedTotal > 0
    ? `Every invoice you've sent has been paid. ${formatGBP(uninvoicedTotal)} of agreed work hasn't been invoiced yet.`
    : "Every invoice you've sent has been paid.";

/**
 * A draft with nothing in it — no customer, no value.
 *
 * "Type the quote in instead" inserts the draft the instant it is clicked,
 * before a word is typed, so every abandoned tap leaves a row behind. On
 * 19 Sep a QA dashboard carried eighteen of them: every card reading "Untitled
 * quote / started today", every one offering Archive and nothing else, and all
 * eighteen counted in the "Your move" badge.
 *
 * That badge is the product's claim about what needs the contractor. Counting
 * a record they never entered anything into makes the claim false, and eighteen
 * identical cards bury the drafts they really did start.
 *
 * NARROW ON PURPOSE. A draft with a customer and no lines, or lines and no
 * customer, is work in progress and still theirs to finish — it keeps counting.
 * Only the both-empty case is filtered, because only that one can be created
 * without the contractor entering anything at all.
 *
 * This hides the row rather than deleting it: the record is harmless once it
 * stops making a claim, and deleting on the contractor's behalf is a different
 * decision. Not persisting until there is content is the real fix and is a
 * larger change to how /jobs/new routes — see the note on startManual.
 */
export const isEmptyDraft = (draft: {
  total: number | null;
  job: { customer: { name: string } | null } | null;
}): boolean => (draft.total ?? 0) === 0 && !draft.job?.customer?.name?.trim();
