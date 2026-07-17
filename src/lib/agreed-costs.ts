import type { LineItem } from "@/lib/schemas/job";
import { lineItemTotal } from "@/lib/quote-math";

// Deterministically overrides labour-line unit_price with a day rate the
// contractor already agreed directly with the customer (checklist question
// 5) — this takes precedence over the contractor's own stored day_rate
// (applyLabourRates), since an agreed rate for THIS job is more specific
// than a general default. Overtime lines are left untouched: the agreed
// day_rate is understood to cover standard working days only, and
// agreedCostsSchema has no separate overtime figure to reconcile against.
export const applyAgreedDayRate = (
  lineItems: LineItem[],
  dayRate: number | null | undefined,
): LineItem[] => {
  if (dayRate == null) return lineItems;
  return lineItems.map((item) =>
    item.category === "labour" && !item.overtime ? { ...item, unit_price: dayRate } : item,
  );
};

// Deterministically reconciles the whole quote to a fixed price the
// contractor already agreed with the customer (checklist question 5) — the
// total must land exactly on that figure, never be silently overridden by
// the pricing engine. Rather than adding a balancing/adjustment line (which
// could require a negative unit_price — disallowed by lineItemSchema),
// every line item's unit_price is scaled by the same factor so relative
// weighting between line items (labour vs materials) is preserved and the
// new subtotal reconciles to fixedPrice.
export const applyAgreedFixedPrice = (
  lineItems: LineItem[],
  fixedPrice: number | null | undefined,
): LineItem[] => {
  if (fixedPrice == null || lineItems.length === 0) return lineItems;
  const currentSubtotal = lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0);
  // Nothing to scale from (e.g. every line item is currently free) — leave
  // as-is rather than divide by zero.
  if (currentSubtotal <= 0) return lineItems;

  const factor = fixedPrice / currentSubtotal;
  return lineItems.map((item) => ({
    ...item,
    unit_price: Math.round(item.unit_price * factor * 100) / 100,
  }));
};
