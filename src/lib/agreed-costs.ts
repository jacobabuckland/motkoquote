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
const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  const scaled = lineItems.map((item) => {
    // Scale the per-person day rates too, otherwise a people-based labour
    // line's total (read from `people`) wouldn't move and the subtotal
    // wouldn't reconcile to fixedPrice.
    if (item.people && item.people.length > 0) {
      return {
        ...item,
        unit_price: round2(item.unit_price * factor),
        people: item.people.map((p) => ({ ...p, day_rate: round2(p.day_rate * factor) })),
      };
    }
    return { ...item, unit_price: round2(item.unit_price * factor) };
  });

  // Rounding each line independently leaves the subtotal a penny or two off the
  // agreed figure (e.g. 30 → 100 across three £10 lines lands on £99.99). The
  // customer agreed to fixedPrice EXACTLY, so absorb the residual into a single
  // line rather than shipping a quote that silently misses the number.
  const residual = round2(fixedPrice - scaled.reduce((sum, item) => sum + lineItemTotal(item), 0));
  if (residual === 0) return scaled;

  // Reconcile on the largest line whose total is driven by unit_price (i.e. not
  // a per-person labour line) so the per-unit tweak is smallest and stays
  // non-negative; fall back to the largest people-driven line otherwise.
  const nonPeople = scaled
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !(item.people && item.people.length > 0));
  const pool = nonPeople.length > 0 ? nonPeople : scaled.map((item, index) => ({ item, index }));
  const target = pool.reduce((best, cur) =>
    lineItemTotal(cur.item) > lineItemTotal(best.item) ? cur : best,
  );

  const item = target.item;
  const next = [...scaled];
  if (item.people && item.people.length > 0) {
    // Nudge the first crew member's day rate so the line total moves by exactly
    // the residual: line total = sum(days*day_rate) * multiplier.
    const mult = item.multiplier ?? 1;
    const first = item.people[0]!;
    if (first.days > 0 && mult > 0) {
      const people = [...item.people];
      people[0] = { ...first, day_rate: first.day_rate + residual / (mult * first.days) };
      const adjusted = { ...item, people };
      if (people[0].day_rate >= 0) next[target.index] = adjusted;
    }
  } else {
    const divisor = item.quantity * (item.multiplier ?? 1) * (item.people_count ?? 1);
    if (divisor > 0) {
      const unitPrice = round2(lineItemTotal(item) + residual) / divisor;
      if (unitPrice >= 0) next[target.index] = { ...item, unit_price: unitPrice };
    }
  }
  return next;
};
