import type { LineItem } from "@/lib/schemas/job";
import { lineItemTotal } from "@/lib/quote-math";
import { resolvePricingMode, type SowState } from "@/lib/schemas/sow";

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

/**
 * WHICH agreed fixed price actually applies, given how the contractor asked for
 * this quote to be priced.
 *
 * Two fields hold a total for one job, and they answer two different questions:
 *
 *   agreed_costs.fixed_price  "was anything already agreed with the customer?"
 *   pricing.fixed_amount      "how do you want THIS priced?"
 *
 * Both behaviours are right on their own. An already-agreed figure scales the
 * breakdown proportionally so the subtotal lands on the promised number with the
 * itemisation intact (applyAgreedFixedPrice below). A stated fixed price
 * collapses the defined works to one line at that figure (applyPricingMode).
 * What was wrong is that they were CHAINED rather than ordered: scale to A, then
 * throw the scaled breakdown away and write one line at B.
 *
 * The scaling therefore had no effect on what the customer is charged — and one
 * effect nobody chose. `drafted_line_items_json` is the baseline the editor
 * restores when the contractor switches out of fixed mode, and it was being
 * stored SCALED to a figure that never reached the document. Quote 8c072bc2 on
 * production carries three drafted lines scaled to £200 under a single £200
 * works line; switching it to calculated hands back a breakdown nobody priced.
 *
 * It also blinded the guard added for exactly this. absorbedByFixedPrice
 * compares pricing.fixed_amount against the defined works of the calculated
 * breakdown — so when the breakdown had already been scaled to the OTHER stated
 * figure, "the priced work came to £2,000" named the other field rather than any
 * priced work. Where the two agreed it made them equal and the guard fell
 * silent; where they disagreed the sentence was false.
 *
 * So in fixed mode the earlier agreed figure is CONTEXT, not an instruction: the
 * contractor has restated the price for this quote and that restatement governs.
 * It is not discarded — agreedPriceDisagrees still puts both numbers in front of
 * them at send time, which is the right place to notice two figures for one job.
 * Outside fixed mode it scales exactly as it always has.
 */
export const agreedFixedPriceInEffect = (
  sow: Pick<SowState, "pricing" | "agreed_costs">,
): number | null => {
  if (resolvePricingMode(sow) === "fixed") return null;
  return sow.agreed_costs?.fixed_price ?? null;
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
