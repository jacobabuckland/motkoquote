import { lineItemTotal } from "@/lib/quote-math";
import {
  UNRESOLVED_RATE_FLAG,
  UNSOURCED_PRICE_FLAG,
} from "@/lib/compile-draft";
import type { LineItem } from "@/lib/schemas/job";

// ---------------------------------------------------------------------------
// Keeping the two blocking flags honest after an edit.
//
// Both flags above are pure functions of the line items: the labour one is
// raised iff some labour line is `unpriced`, the materials one iff some
// non-labour line is. But they were written ONLY by a full compile, and every
// later writer of `line_items_json` carried them forward untouched. So a
// contractor who fixed exactly what a flag named still could not send.
//
// That is not a tidiness problem. Quote `b3112196` went out to a live
// diagnostic call on 3 Sep: fixed price £450, one works line at £450, subtotal
// £450, VAT £90, total £540 — every figure present — and the send refused with
// "no day rate was found, so the labour has no figure. Add your day rate in
// Business details". The day rate was £250 and had been for hours. The flag was
// a leftover from the original compile of four drafted lines, and NOTHING in
// the tree removed it, so there was no way out through the interface at all.
//
// The fix is to derive both flags from the lines on every write rather than
// inherit them. The predicates live here, beside the constants, so the
// recompute and the compile can never disagree about what "unpriced" means.
// ---------------------------------------------------------------------------

export const hasUnpricedLabour = (items: LineItem[]): boolean =>
  items.some((item) => item.unpriced === true && item.category === "labour");

export const hasUnpricedNonLabour = (items: LineItem[]): boolean =>
  items.some((item) => item.unpriced === true && item.category !== "labour");

/**
 * Drops `unpriced` from any line that now carries a real amount.
 *
 * The decided behaviour (3 Sep): typing a price into an unpriced line clears
 * the "to be confirmed" state automatically — typing the number IS the
 * confirmation, and a second tap is friction on a path the contractor already
 * had to hunt for. Without this the total silently includes a figure while the
 * customer document still says the item is excluded from it, which is a wrong
 * number on a document a customer reads.
 *
 * Tested on the line TOTAL, not `unit_price`: a labour line priced from a crew
 * breakdown keeps unit_price only as a denormalised cache, so reading it would
 * miss a correctly priced team.
 *
 * A line still at zero stays unpriced. That is deliberate and conservative — a
 * £0.00 a customer reads as "free" is the exact thing the flag exists to stop,
 * and a genuinely intentional zero has its own confirmation path at send time
 * (ZERO_TOTAL_CONFIRM_REQUIRED). Customer-supplied lines are unaffected either
 * way: they are priced at £0 deliberately and were never marked unpriced.
 */
export const clearUnpricedWhenPriced = (items: LineItem[]): LineItem[] =>
  items.map((item) =>
    item.unpriced === true && lineItemTotal(item) > 0
      ? { ...item, unpriced: false }
      : item,
  );

/**
 * Recomputes the two send-blocking flags from the current lines, leaving every
 * other flag alone.
 *
 * Removes then re-adds, so a flag whose cause the contractor has fixed
 * disappears and one whose cause remains survives — the flag describes the
 * quote as it is now, which is what the constants above claim and what the
 * send guard assumes.
 */
export const reconcileUnpricedFlags = (
  flags: string[] | null | undefined,
  items: LineItem[],
): string[] => {
  const kept = (flags ?? []).filter(
    (flag) => flag !== UNRESOLVED_RATE_FLAG && flag !== UNSOURCED_PRICE_FLAG,
  );

  return [
    ...kept,
    ...(hasUnpricedLabour(items) ? [UNRESOLVED_RATE_FLAG] : []),
    ...(hasUnpricedNonLabour(items) ? [UNSOURCED_PRICE_FLAG] : []),
  ];
};
