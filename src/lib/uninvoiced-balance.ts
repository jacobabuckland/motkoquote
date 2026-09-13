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
