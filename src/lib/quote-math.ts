import type { LineItem } from "@/lib/schemas/job";
import { chargedLines } from "@/lib/quote-lines";

/**
 * Exported so a write path can RECORD the rate it applied, per migration 80.
 * A constant in code cannot promise that a future rate change will not restate
 * what was charged at 20%; a column can.
 */
export const VAT_RATE = 0.2;

export const lineItemTotal = (item: LineItem): number => {
  // A labour line with a per-person crew breakdown is priced from that
  // breakdown — sum(days * day_rate) across the crew, so a mixed-rate team
  // (owner £340 + apprentice £120) totals correctly on one line. The
  // multiplier still applies (e.g. 1.5x difficult access). unit_price /
  // people_count are ignored here (they're kept only as a denormalised cache
  // for consumers that don't read `people`).
  if (item.people && item.people.length > 0) {
    const crew = item.people.reduce((sum, p) => sum + p.days * p.day_rate, 0);
    return Math.round(crew * (item.multiplier ?? 1) * 100) / 100;
  }
  // Line items are read from line_items_json via a type cast, not zod
  // parsing (several call sites: quote editor, public quote page, PDF
  // renderer, contract variables) — so quotes drafted before multiplier or
  // people_count existed have them genuinely missing at runtime despite the
  // LineItem type saying they're required. Default both to 1 (no
  // adjustment) rather than producing NaN totals for every pre-existing
  // quote. people_count only matters for labour lines split across a team;
  // every other line item is effectively people_count=1, so this is a
  // no-op for non-labour totals.
  return (
    Math.round(
      item.quantity *
        item.unit_price *
        (item.multiplier ?? 1) *
        (item.people_count ?? 1) *
        100,
    ) / 100
  );
};

/**
 * The per-unit rate to DISPLAY for a line, which is not always `unit_price`.
 *
 * On a crew line `unit_price` is a denormalised cache that `lineItemTotal`
 * above explicitly ignores — the charge comes from summing the crew's
 * days × day_rate. Rendering the cache beside that total puts two unrelated
 * numbers on one row:
 *
 *     24 day @ £934.33 ............................ £4,400.00
 *
 * where 24 × £934.33 is £22,423.92. Reported 13 Sep, and confirmed present in
 * the quote PDF the customer receives — so a customer reads a day rate five
 * times the one actually charged, on the document they keep. The charge itself
 * was never wrong.
 *
 * Derived from the line's own total so the row reconciles with itself: the
 * blended rate across the crew, which is what the row is claiming. A quote that
 * already displays correctly is untouched — the same job's sibling line
 * renders `30 day @ £183.33` today, and this returns exactly that.
 *
 * ALSO APPLIED TO THE MULTIPLIER, since 13 Sep. The first version of this
 * deliberately did not, on the reasoning that an uplift raises a separate
 * question about presentation. That reasoning was wrong, and the editor's own
 * labels are what settle it: the field holding `unit_price` is labelled
 * **"Cost (£)"**, and `multiplier` is labelled **"Markup"** with the helper
 * text "2 = 100% on top of cost".
 *
 * So `unit_price` is the contractor's BUYING PRICE, and rendering it in a
 * column headed UNIT PRICE puts their cost on the document the customer keeps.
 * Reported 13 Sep against a materials line — 18 sheets, cost £11.50, markup 2:
 *
 *     18 sheet @ £11.50 ........................... £414.00
 *
 * 18 × £11.50 is £207. A customer who multiplies sees an apparent double
 * charge, and the figure they are checking against is the trade's cost price.
 * The 100% materials markup is the default for a trade whose profile sets one,
 * so this is the ordinary path for materials rather than an edge case.
 *
 * The rule is therefore general: the displayed rate is the line's own total
 * over its own quantity, so the row always reconciles with itself. Nothing
 * about the charge changes — `lineItemTotal` is untouched, and a line whose
 * quantity × unit_price already equals its total renders exactly as before.
 */
export const displayedUnitRate = (item: LineItem): number => {
  if (item.quantity > 0) {
    return Math.round((lineItemTotal(item) / item.quantity) * 100) / 100;
  }
  // Nothing to divide by. The cache is the only figure available, and a
  // zero-quantity line contributes nothing to the total anyway.
  return item.unit_price;
};

/**
 * The net total of a set of lines, to the penny.
 *
 * Byte-for-byte what every call site did independently: add up `lineItemTotal`
 * and round the TOTAL once. Note that `lineItemTotal` already rounds each line
 * itself, so this is a second rounding on top of a per-line one — pre-existing
 * behaviour, preserved deliberately rather than tidied, because changing where a
 * quote rounds changes what a customer is charged.
 *
 * Lives here rather than in quote-lines.ts so the dependency runs one way:
 * quote-math knows about the subsets, the subsets know nothing about totalling.
 */
export const sumLines = (lineItems: LineItem[]): number =>
  Math.round(lineItems.reduce((sum, item) => sum + lineItemTotal(item), 0) * 100) / 100;

// The crew size the pricing actually used — the widest per-person breakdown
// across the labour lines. Lets the timeline read "2-person team" from the
// same source the money comes from, rather than a separately-captured count
// that can drift (the Fenland "1-person team" understatement). Returns 0 when
// no labour line carries a crew breakdown, so callers can fall back.
export const labourCrewSize = (lineItems: LineItem[]): number =>
  lineItems.reduce(
    (max, item) =>
      item.category === "labour" && item.people ? Math.max(max, item.people.length) : max,
    0,
  );

export const computeQuoteTotals = (
  lineItems: LineItem[],
  vatRegistered: boolean,
) => {
  // THE CHARGED SET — provisional sums included. A provisional sum is an
  // estimate within the quote, not an exclusion from it: it is on the document
  // and the customer pays it unless revised, so it is in the subtotal and VAT is
  // charged on it. Deliberately a WIDER set than the one reconcileStatedPrice
  // compares a fixed price against; see quote-lines.ts for why the two differ.
  const subtotal = sumLines(chargedLines(lineItems));
  const vat = vatRegistered ? Math.round(subtotal * VAT_RATE * 100) / 100 : 0;
  const total = Math.round((subtotal + vat) * 100) / 100;

  return { subtotal, vat, total };
};
