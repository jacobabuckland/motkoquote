import type { LineItem } from "@/lib/schemas/job";
import { chargedLines } from "@/lib/quote-lines";
import { lineItemTotal, VAT_RATE } from "@/lib/quote-math";
import { invoiceVatFor } from "@/lib/vat-record";

/**
 * Recovering the VAT split a legacy quote never recorded.
 *
 * WHY THIS IS NEEDED AT ALL. Migration 80 added `subtotal`, `vat_amount` and
 * `vat_rate` to `quotes`, and every row written since carries them. The rows
 * written BEFORE it carry only `total`, and pass 5 decided — rightly — that
 * where nothing was recorded the stored total is what was charged and no split
 * is asserted (`quoteTotalsForDisplay`).
 *
 * That rule is honest and it is also, on a subset of those rows, visibly wrong
 * to a customer. The old code computed `total = computeQuoteTotals(lineItems,
 * vatRegistered).total`, so a quote written while registered stored a total
 * that is 1.2x the sum of its own lines. /q/[id] now renders those lines under
 * that total with nothing to explain the gap:
 *
 *     Works — see Scope of work ................... £450.00
 *     Total ....................................... £540.00
 *
 * on a page with a live Accept button (quote b3112196, reported 14 Sep). The
 * divergence notice that used to flag it was removed in the same pass, so the
 * page went from wrong-and-shouting to wrong-and-quiet.
 *
 * WHAT MAKES THE RECOVERY SAFE. The gap is not a guess. `total / items` is
 * either 1.2 or 1.0, and those two hypotheses are 20% apart, so no rounding
 * window can confuse them. A row matching neither is the interesting case — a
 * quote edited after its total was stored — and it is SKIPPED, never
 * apportioned.
 *
 * Both branches restate what the old code did rather than deciding anything new:
 *
 *     total == items * 1.2  ->  subtotal = items, vat = total - items
 *     total == items        ->  subtotal = total, vat = 0
 *
 * THE SECOND BRANCH IS NOT A TAX JUDGEMENT, which it might look like. The
 * concern would be that a registered trader's stated price is VAT-inclusive
 * whatever the document said, so `vat = 0` would understate. But every contract
 * carries a `vat_registered` snapshot taken at generation, and all seven quotes
 * on production matching this branch were generated while the trade was not
 * registered. Zero is what was charged.
 *
 * NOTHING RECORDED IS EVER OVERWRITTEN. A row that already has both columns is
 * skipped whatever it says — this fills blanks, and a backfill that can restate
 * a recorded figure is the defect it exists to remove.
 */

export type LegacyQuote = {
  id: string;
  total: number;
  subtotal: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
  line_items: LineItem[];
};

export type LegacyInvoice = {
  id: string;
  amount: number;
  vat_amount: number | null;
};

export type InvoiceVatPlan = {
  id: string;
  vat_amount: number;
  vat_rate: number;
};

export type QuoteVatPlan =
  | {
      action: "record";
      id: string;
      /** Which hypothesis matched — carried so the dry-run can show its working. */
      shape: "grossed" | "net";
      lineItemSum: number;
      subtotal: number;
      vat_amount: number;
      vat_rate: number;
      invoices: InvoiceVatPlan[];
    }
  | {
      action: "skip";
      id: string;
      reason:
        | "already-recorded"
        | "no-stored-total"
        | "no-line-items"
        | "indeterminate"
        | "over-invoiced";
    };

const round2 = (value: number): number => Math.round(value * 100) / 100;

export const sumLineItems = (lineItems: LineItem[]): number =>
  round2(chargedLines(lineItems).reduce((sum, item) => sum + lineItemTotal(item), 0));

/**
 * How far `total` may sit from a hypothesis and still match it.
 *
 * Per-line rounding accumulates, so an exact equality test rejects rows that
 * are plainly one shape or the other — quote 0fb6d475 stores £4,284.00 against
 * £3,570.04 of lines, and 3570.04 * 1.2 is 4284.048. A window of 0.1% absorbs
 * that while staying two orders of magnitude inside the 20% that separates the
 * two hypotheses, so it cannot turn one into the other. The 5p floor keeps the
 * window usable on the £1 test rows.
 */
const toleranceFor = (total: number): number => Math.max(0.05, Math.abs(total) * 0.001);

export const planLegacyQuoteVat = (
  quote: LegacyQuote,
  invoices: LegacyInvoice[],
): QuoteVatPlan => {
  const skip = (reason: Extract<QuoteVatPlan, { action: "skip" }>["reason"]): QuoteVatPlan => ({
    action: "skip",
    id: quote.id,
    reason,
  });

  // Loose `!= null` to match quoteTotalsForDisplay: undefined and null both
  // mean nobody wrote the figure down, and a column absent from a select
  // arrives as undefined.
  if (quote.subtotal != null && quote.vat_amount != null) return skip("already-recorded");
  if (!(quote.total > 0)) return skip("no-stored-total");

  const lineItemSum = sumLineItems(quote.line_items);
  if (!(lineItemSum > 0)) return skip("no-line-items");

  const tolerance = toleranceFor(quote.total);
  const grossed = Math.abs(quote.total - lineItemSum * (1 + VAT_RATE)) <= tolerance;
  const net = Math.abs(quote.total - lineItemSum) <= tolerance;

  // Both can only match where the total is inside the tolerance of itself and
  // of 1.2x itself, which needs a total of roughly nothing. Preferring `net`
  // there asserts no VAT, which is the direction that cannot invent a charge.
  if (!grossed && !net) return skip("indeterminate");

  const subtotal = net ? quote.total : lineItemSum;
  const vat_amount = net ? 0 : round2(quote.total - lineItemSum);

  const invoicedSoFar = round2(invoices.reduce((sum, inv) => sum + inv.amount, 0));
  if (invoicedSoFar - quote.total > tolerance) return skip("over-invoiced");

  // Allocated in the order the invoices were raised, so the settling one takes
  // the remainder — the same rule `invoiceVatFor` applies live. Siblings are
  // accumulated as the loop goes rather than read from the row, because the
  // rows being planned are exactly the ones whose `vat_amount` is still null.
  const allocated: { amount: number; vat_amount: number | null }[] = [];
  const invoicePlans: InvoiceVatPlan[] = [];
  for (const invoice of invoices) {
    const share = invoiceVatFor(
      invoice.amount,
      { total: quote.total, vat_amount, vat_rate: VAT_RATE },
      allocated,
    );
    const amount = invoice.vat_amount ?? share?.vat_amount ?? 0;
    allocated.push({ amount: invoice.amount, vat_amount: amount });
    // Only blanks are filled. An invoice that already records its VAT still
    // contributes to the allocation above, so the settling row's remainder is
    // computed against what is really there.
    if (invoice.vat_amount == null) {
      invoicePlans.push({ id: invoice.id, vat_amount: amount, vat_rate: VAT_RATE });
    }
  }

  return {
    action: "record",
    id: quote.id,
    shape: net ? "net" : "grossed",
    lineItemSum,
    subtotal,
    vat_amount,
    vat_rate: VAT_RATE,
    invoices: invoicePlans,
  };
};
