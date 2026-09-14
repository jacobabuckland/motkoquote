import { computeQuoteTotals, VAT_RATE } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";

/**
 * The VAT figures to WRITE alongside a money row.
 *
 * Every surface used to recompute VAT from the contractor's current
 * `vat_registered` flag. That made a charged figure a function of a setting
 * rather than a historical fact, so toggling registration restated the past:
 * a £6,000 quote read £7,200 on one screen and £6,000 on another, and £11,288
 * collected before registration had £2,177 of VAT set aside against it.
 *
 * What a customer was charged does not change when the trade's status does.
 * So it is recorded when the row is written, and read back rather than
 * re-derived.
 *
 * The RATE is stored too. A future change to the UK rate must not restate what
 * was charged at 20%, and a constant in the code cannot promise that.
 */
export type VatRecord = {
  subtotal: number;
  vat_amount: number;
  vat_rate: number;
};

export const vatRecordFor = (lineItems: LineItem[], vatRegistered: boolean): VatRecord => {
  const { subtotal, vat } = computeQuoteTotals(lineItems, vatRegistered);
  return {
    subtotal,
    vat_amount: vat,
    // Recorded even when unregistered, where the rate is what WOULD have
    // applied and the amount is zero. A zero vat_amount beside a real rate says
    // "no VAT was charged"; a null rate says "nobody wrote it down". Those are
    // different answers and the difference is the whole point of this file.
    vat_rate: VAT_RATE,
  };
};

/**
 * The VAT inside an invoice, in the same proportion the quote recorded.
 *
 * An invoice is raised for some part of a quote — a deposit, a balance, the
 * whole thing — so its VAT is that same part of the quote's VAT. Deriving it
 * from the invoice amount and a rate would disagree with the quote by a penny
 * or two on most splits, and the two documents must agree.
 *
 * Returns null when the quote itself has no recorded VAT, which is the honest
 * answer for a quote written before this existed: unknown, not zero.
 */
export const invoiceVatFor = (
  invoiceAmount: number,
  quote: { total: number; vat_amount: number | null; vat_rate: number | null },
): { vat_amount: number; vat_rate: number } | null => {
  if (quote.vat_amount === null || quote.vat_rate === null) return null;
  if (quote.total <= 0) return { vat_amount: 0, vat_rate: quote.vat_rate };
  const share = invoiceAmount / quote.total;
  return {
    vat_amount: Math.round(quote.vat_amount * share * 100) / 100,
    vat_rate: quote.vat_rate,
  };
};

/**
 * Net of an invoice, or null where its VAT was never recorded.
 *
 * Null is deliberately not 0 and not the gross amount. A caller that wants to
 * report "invoiced, net" must decide what to do about rows that cannot answer,
 * and returning the gross would quietly restate the same defect this file
 * exists to remove — a figure labelled net that is not.
 */
export const invoiceNet = (invoice: { amount: number; vat_amount: number | null }): number | null =>
  invoice.vat_amount === null
    ? null
    : Math.round((invoice.amount - invoice.vat_amount) * 100) / 100;

/**
 * The totals to DISPLAY for a quote: the recorded ones where they exist.
 *
 * This is the read half of migration 80, and the direct fix for the £6,000 /
 * £7,200 divergence. The job page read the stored `quotes.total` while
 * /q/[id] and the editor recomputed from live line items and the contractor's
 * CURRENT registration — so the same quote showed two figures the moment the
 * flag moved without a re-save, differing by exactly the VAT rate.
 *
 * Jacob, 14 Sep: "£7,200 would be right if the company is VAT registered."
 * The stored, VAT-inclusive total is the answer. It is what was computed when
 * the quote was last written and what the customer was told.
 *
 * FALLS BACK TO RECOMPUTING only where nothing was recorded — a quote written
 * before migration 80. There is no better answer for those, and refusing to
 * show a total at all would be worse than showing the one the app has always
 * shown. `recorded` says which happened, so a surface can mark an inferred
 * figure if it wants to; nothing is forced to care.
 */
export const quoteTotalsForDisplay = (
  quote: { total: number; subtotal: number | null; vat_amount: number | null },
  lineItems: LineItem[],
  vatRegistered: boolean,
): { subtotal: number; vat: number; total: number; recorded: boolean } => {
  // LOOSE `!= null` on purpose: it catches `undefined` as well as `null`, and
  // both mean the same thing here — nobody wrote the figure down. A strict
  // check took the recorded branch for a row whose columns were simply absent
  // from the select and returned `undefined` as the total, which is how the
  // quote-PDF goldens caught this.
  if (quote.subtotal != null && quote.vat_amount != null) {
    return {
      subtotal: quote.subtotal,
      vat: quote.vat_amount,
      total: quote.total,
      recorded: true,
    };
  }
  const computed = computeQuoteTotals(lineItems, vatRegistered);
  return { ...computed, recorded: false };
};
