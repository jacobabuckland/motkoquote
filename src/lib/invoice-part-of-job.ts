import { invoiceNet } from "@/lib/vat-record";

/**
 * What an invoice is a PART of, when it is not the whole job.
 *
 * A final invoice describes the whole scope — it is the same work — but charges
 * only the balance. Reported 15 Sep: a document headed VAT INVOICE listing the
 * full scope, then "Net £693.00", against a quote whose lines for that scope
 * come to £990.00 net. Nothing said where the £297.00 went, and the reader is a
 * bookkeeper.
 *
 * Returns null wherever the statement could not be made honestly:
 *
 *   - the invoice IS the whole job, so there is nothing to explain
 *   - the quote never recorded its VAT split, so its net is unknown
 *   - any earlier invoice never recorded its VAT split, so what has already
 *     been invoiced, net, is unknown
 *
 * `invoiceNet` returns null rather than guessing for exactly these rows, and a
 * net figure assembled from a guess has no place on a VAT invoice. Silence is
 * the honest answer; it leaves the document as it is today.
 */
export const invoicePartOfJob = (input: {
  quote: { total: number; vat_amount: number | null };
  /** Every invoice raised against the quote BEFORE this one. */
  earlierInvoices: { amount: number; vat_amount: number | null }[];
}): { jobNet: number; alreadyInvoicedNet: number } | null => {
  if (input.earlierInvoices.length === 0) return null;

  const jobNet = invoiceNet({
    amount: input.quote.total,
    vat_amount: input.quote.vat_amount,
  });
  if (jobNet === null) return null;

  let alreadyInvoicedNet = 0;
  for (const earlier of input.earlierInvoices) {
    const net = invoiceNet(earlier);
    if (net === null) return null;
    alreadyInvoicedNet += net;
  }

  const rounded = Math.round(alreadyInvoicedNet * 100) / 100;
  // Nothing to explain if the earlier invoices came to nothing.
  if (rounded <= 0) return null;
  return { jobNet, alreadyInvoicedNet: rounded };
};
