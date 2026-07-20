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
  return lineItems.map((item) => {
    if (item.category !== "labour" || item.overtime) return item;
    // A per-person crew breakdown is the source of truth for the amount
    // (lineItemTotal reads `people`, not unit_price), so the agreed day rate
    // has to be written onto every person to actually take effect.
    if (item.people && item.people.length > 0) {
      return {
        ...item,
        unit_price: dayRate,
        people: item.people.map((p) => ({ ...p, day_rate: dayRate })),
      };
    }
    return { ...item, unit_price: dayRate };
  });
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
  return lineItems.map((item) => {
    // Scale the per-person day rates too, otherwise a people-based labour
    // line's total (read from `people`) wouldn't move and the subtotal
    // wouldn't reconcile to fixedPrice.
    if (item.people && item.people.length > 0) {
      return {
        ...item,
        unit_price: Math.round(item.unit_price * factor * 100) / 100,
        people: item.people.map((p) => ({
          ...p,
          day_rate: Math.round(p.day_rate * factor * 100) / 100,
        })),
      };
    }
    return { ...item, unit_price: Math.round(item.unit_price * factor * 100) / 100 };
  });
};
