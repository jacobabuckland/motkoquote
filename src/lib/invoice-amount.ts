// Server-authoritative invoice amounts. The client sends only its intent
// (deposit vs final) — never a figure — so a tampered request can't invoice an
// arbitrary sum or over-invoice past the quote total. Pure and deterministic so
// the rules are unit-testable without a database.

export type ExistingInvoice = { amount: number; invoice_type: string };
export type QuoteContract = { deposit_pct: number | null; status: string };

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
// a customer-safe message when the request is not a legal next invoice (second
// deposit, nothing left to invoice, no deposit percentage set, or a derivation
// that would exceed the quote total).
export const deriveInvoiceAmount = (
  invoiceType: "deposit" | "final",
  quoteTotal: number,
  existingInvoices: ExistingInvoice[],
  contracts: QuoteContract[],
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

  const amount = round2(quoteTotal - invoicedSoFar);
  if (amount <= 0) throw new Error("This quote is already fully invoiced.");
  return amount;
};
