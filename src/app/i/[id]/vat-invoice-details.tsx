import { formatDate, formatGBP } from "@/lib/format";
import type { SupplyDescription } from "@/lib/invoice-supply";
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
  /**
   * What was supplied, itemised from the quote the customer agreed to.
   *
   * The first version of this was a single `description` carrying the job
   * TYPE — "Plastering" — which identifies a trade rather than a supply. An
   * accountant handed that on a £3,620.28 invoice bounces it, and a VAT
   * invoice is required to identify the goods or services and their extent.
   * See `describeSupply`.
   */
  supply?: SupplyDescription | null;
  /**
   * What this invoice is a PART of, when it is not the whole job.
   *
   * A final invoice describes the whole scope — it is the same work — but
   * charges only the balance. Reported 15 Sep: a document headed VAT INVOICE
   * listing "Skim and finish ceilings — 3 bedrooms / Plasterboard, scrim tape
   * and finish plaster", then "Net £693.00", against a quote whose lines for
   * that scope are £750.00 and £240.00. Nothing on the page said where the
   * difference went, and a customer's bookkeeper is the one reading it.
   *
   * Null where there is nothing to explain — a single invoice for the whole
   * job — or where it cannot be stated honestly, which is any quote or sibling
   * invoice whose VAT was never recorded: `invoiceNet` returns null there, and
   * a net figure assembled from a guess does not belong on a VAT invoice.
   */
  partOfJob?: { jobNet: number; alreadyInvoicedNet: number } | null;
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

  // A VAT INVOICE IS ONE THAT CHARGED VAT. Not one raised by a trade who is
  // registered today.
  //
  // The first version of this gated on the columns being recorded, so an
  // unregistered trade's invoice — recorded VAT £0.00 — still came out headed
  // "VAT invoice", citing a VAT number, and stating "VAT (20%) £0.00" on a
  // supply that carried none. Reported 14 Sep on a £222 deposit. That is the
  // same defect as the "VAT (20%) £0.00" row on the quote, on a document with
  // more legal weight: it asserts a taxable supply that did not happen.
  //
  // Both halves of the split are still required — a rate with no amount, or an
  // amount with no rate, describes half a split and is worse than none.
  const chargedVat = facts.vatAmount !== null && facts.vatAmount > 0;
  const showVatBreakdown =
    chargedVat && net !== null && facts.vatRate !== null && Boolean(facts.supplier.vatNumber);

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
        {/* The number belongs on a document that charged VAT, and nowhere else.
            Printing it above "VAT (20%) £0.00" tells a customer's accountant
            there is input tax to reclaim when there is none. */}
        {showVatBreakdown && facts.supplier.vatNumber && (
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

      {facts.supply && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-5">
          <p className="eyebrow">{facts.supply.heading}</p>
          {/* Unpriced on purpose. A deposit invoice's amount is a payment on
              account against all of this, so a price beside each line would
              not sum to the figure below it. The supply is described here; the
              amount is stated once, in the totals block. */}
          <ul className="flex flex-col gap-1">
            {facts.supply.lines.map((line, index) => (
              <li key={index} className="text-sm">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line pt-5">
        {showVatBreakdown ? (
          <>
            {facts.partOfJob && (
              <>
                <Row label="Job total (net)" value={formatGBP(facts.partOfJob.jobNet)} />
                <Row
                  label="Less already invoiced"
                  value={`−${formatGBP(facts.partOfJob.alreadyInvoicedNet)}`}
                />
              </>
            )}
            <Row label={facts.partOfJob ? "Net now due" : "Net"} value={formatGBP(net)} />
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
