import { formatDate, formatGBP } from "@/lib/format";
import { invoiceNet } from "@/lib/vat-record";

/**
 * The part that makes this a document rather than a demand.
 *
 * Reported 14 Sep: `/i/[id]` was a business name, "Invoice for <customer>",
 * "Amount due £740.00", a due date and a pay button. A VAT-registered limited
 * company had sent a customer a request for £3,620.28 containing nothing they
 * or their accountant could reclaim against — no VAT breakdown, no VAT number,
 * no supplier address, no invoice number, no description of the work.
 *
 * Everything here is READ, never derived from a current setting:
 *
 *   * The VAT split comes from `invoices.vat_amount` and `vat_rate`, recorded
 *     when the invoice was raised (migration 80). Where they are null the
 *     invoice predates that and the breakdown is omitted entirely rather than
 *     computed from today's registration — an invoice that silently restates
 *     its own VAT is the defect this file exists to avoid repeating.
 *   * The VAT number is the trade's own. No number, no VAT block: an
 *     unregistered trade's invoice must not carry one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. The reference below is derived from the
 * invoice id, so it is unique and stable but NOT sequential. HMRC asks for a
 * sequential number, and a real one needs a per-contractor counter, a migration
 * and a decision about what happens to the numbers already issued. That is a
 * separate item; a stable unique reference is strictly better than the nothing
 * that was here, and it does not pretend to be the other thing.
 */
export type VatInvoiceFacts = {
  invoiceId: string;
  issuedAt: string;
  dueDate: string | null;
  amount: number;
  vatAmount: number | null;
  vatRate: number | null;
  supplier: {
    companyName: string;
    address?: string | null;
    companyNumber?: string | null;
    vatNumber?: string | null;
  };
  customerName?: string | null;
  siteAddress?: string | null;
  description?: string | null;
};

/**
 * A stable human reference for one invoice. Same shape the quote PDF uses for
 * its own reference, for the same reason: eight hex characters a person can
 * read down a phone without transcribing a UUID.
 */
export const invoiceReference = (invoiceId: string): string =>
  invoiceId.replace(/-/g, "").slice(0, 8).toUpperCase();

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className="text-sm text-ink-secondary">{label}</span>
    <span className="text-sm tabular-nums">{value}</span>
  </div>
);

export const VatInvoiceDetails = ({ facts }: { facts: VatInvoiceFacts }) => {
  const net = invoiceNet({ amount: facts.amount, vat_amount: facts.vatAmount });
  // Both halves required. A rate with no amount, or an amount with no rate,
  // describes half a split and is worse than showing none.
  const showVatBreakdown =
    net !== null && facts.vatAmount !== null && facts.vatRate !== null && facts.supplier.vatNumber;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="eyebrow">{showVatBreakdown ? "VAT invoice" : "Invoice"}</p>
        <Row label="Invoice number" value={invoiceReference(facts.invoiceId)} />
        <Row label="Invoice date" value={formatDate(facts.issuedAt)} />
        {facts.dueDate && <Row label="Payment due" value={formatDate(facts.dueDate)} />}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-5">
        <p className="eyebrow">From</p>
        <p className="text-sm font-medium">{facts.supplier.companyName}</p>
        {facts.supplier.address && (
          <p className="text-sm whitespace-pre-line text-ink-secondary">
            {facts.supplier.address}
          </p>
        )}
        {facts.supplier.companyNumber && (
          <p className="text-sm text-ink-secondary">
            Company number {facts.supplier.companyNumber}
          </p>
        )}
        {facts.supplier.vatNumber && (
          <p className="text-sm text-ink-secondary">VAT number {facts.supplier.vatNumber}</p>
        )}
      </div>

      {(facts.customerName || facts.siteAddress) && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <p className="eyebrow">To</p>
          {facts.customerName && <p className="text-sm font-medium">{facts.customerName}</p>}
          {facts.siteAddress && (
            <p className="text-sm whitespace-pre-line text-ink-secondary">{facts.siteAddress}</p>
          )}
        </div>
      )}

      {facts.description && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <p className="eyebrow">For</p>
          <p className="text-sm">{facts.description}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line pt-5">
        {showVatBreakdown ? (
          <>
            <Row label="Net" value={formatGBP(net)} />
            <Row
              label={`VAT (${Math.round((facts.vatRate ?? 0) * 100)}%)`}
              value={formatGBP(facts.vatAmount ?? 0)}
            />
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-1.5">
              <span className="text-sm font-medium">Total</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatGBP(facts.amount)}
              </span>
            </div>
          </>
        ) : (
          <Row label="Total" value={formatGBP(facts.amount)} />
        )}
      </div>
    </div>
  );
};
