// Server-authoritative invoice amounts. The client sends only its intent
// (deposit vs final) — never a figure — so a tampered request can't invoice an
// arbitrary sum or over-invoice past the quote total. Pure and deterministic so
// the rules are unit-testable without a database.

export type ExistingInvoice = { amount: number; invoice_type: string };
export type QuoteContract = { deposit_pct: number | null; status: string };

/**
 * When the trade marked the work finished, or null if they have not.
 *
 * Required rather than optional, and deliberately so. An optional parameter
 * defaults to "not supplied", a caller that forgets it reads as a job with no
 * completion — and the one thing this must never do is let a Final invoice
 * through by omission. A required parameter makes every call site answer the
 * question, and `tsc` names the ones that do not.
 */
export type JobCompletion = { workCompletedAt: string | null };

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Prefer the signed contract's deposit percentage; fall back to any contract
// that carries one. Returns null when no contract sets a deposit.
const pickDepositPct = (contracts: QuoteContract[]): number | null => {
  const signed = contracts.find((c) => c.status === "signed" && c.deposit_pct != null);
  if (signed?.deposit_pct != null) return signed.deposit_pct;
  const withPct = contracts.find((c) => c.deposit_pct != null);
  return withPct?.deposit_pct ?? null;
};

// Derives the amount for a new invoice from server-held state only. Throws with
// a customer-safe message when the request is not a legal next invoice (a Final
// before the work is done, a second deposit, nothing left to invoice, no deposit
// percentage set, or a derivation that would exceed the quote total).
export const deriveInvoiceAmount = (
  invoiceType: "deposit" | "final",
  quoteTotal: number,
  existingInvoices: ExistingInvoice[],
  contracts: QuoteContract[],
  job: JobCompletion,
): number => {
  const invoicedSoFar = round2(
    existingInvoices.reduce((sum, invoice) => sum + invoice.amount, 0),
  );

  if (invoiceType === "deposit") {
    if (existingInvoices.some((invoice) => invoice.invoice_type === "deposit")) {
      throw new Error("A deposit invoice has already been raised for this quote.");
    }
    const depositPct = pickDepositPct(contracts);
    if (depositPct == null) {
      throw new Error(
        "Set a deposit percentage on the contract before raising a deposit invoice.",
      );
    }
    const amount = round2(quoteTotal * (depositPct / 100));
    if (amount <= 0) throw new Error("The deposit works out to nothing to invoice.");
    if (round2(invoicedSoFar + amount) > quoteTotal) {
      throw new Error("That would invoice more than the quote total.");
    }
    return amount;
  }

  // A FINAL INVOICE ASSERTS THE WORK IS DONE. Before #419 there was no
  // completion concept in the tree to check, so there was no gate here and the
  // app offered a Final invoice for the full quote value with the contract
  // still unsigned and nothing built — pre-filled, one tap from sending.
  // Demanding payment in full from a domestic customer before any work is the
  // exact pattern consumers are warned about.
  //
  // Jacob's answer to D10 (recorded in areas/motko.md, 28 Aug) permits a
  // Deposit or Materials invoice before completion — with a warning in the UI
  // when the contract is also unsigned — but BOTH readings of the review agreed
  // Final is never available before completion. That half needs no
  // interpretation and is the half enforced here.
  //
  // Server-side, beside the rules it belongs with. The dashboard stopped
  // offering the action at the wrong time in PR #411, but hiding a CTA is not a
  // gate: the client sends intent and the server decides, so this is the only
  // place a tampered or stale request is actually refused.
  if (!job.workCompletedAt) {
    throw new Error(
      "Mark the work complete before raising a final invoice. Until then you can raise a deposit invoice.",
    );
  }

  const amount = round2(quoteTotal - invoicedSoFar);
  if (amount <= 0) throw new Error("This quote is already fully invoiced.");
  return amount;
};
