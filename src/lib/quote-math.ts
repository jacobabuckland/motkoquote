import type { LineItem } from "@/lib/schemas/job";

const VAT_RATE = 0.2;

export const lineItemTotal = (item: LineItem): number =>
  Math.round(item.quantity * item.unit_price * item.multiplier * 100) / 100;

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
