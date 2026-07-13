import type { LineItem } from "@/lib/schemas/job";

const VAT_RATE = 0.2;

export const lineItemTotal = (item: LineItem): number =>
  // Line items are read from line_items_json via a type cast, not zod
  // parsing (several call sites: quote editor, public quote page, PDF
  // renderer, contract variables) — so quotes drafted before multiplier
  // existed have it genuinely missing at runtime despite the LineItem type
  // saying it's required. Default to 1 (no adjustment) rather than
  // producing NaN totals for every pre-existing quote.
  Math.round(item.quantity * item.unit_price * (item.multiplier ?? 1) * 100) / 100;

export const computeQuoteTotals = (
  lineItems: LineItem[],
  vatRegistered: boolean,
) => {
  const subtotal =
    Math.round(
      lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;
  const vat = vatRegistered ? Math.round(subtotal * VAT_RATE * 100) / 100 : 0;
  const total = Math.round((subtotal + vat) * 100) / 100;

  return { subtotal, vat, total };
};
