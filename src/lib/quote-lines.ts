import type { LineItem } from "@/lib/schemas/job";

/**
 * The subsets of a quote's lines, named once.
 *
 * Three consumers apply three different filters to the same array, and until now
 * each restated its own:
 *
 *   computeQuoteTotals    every line, provisional sums INCLUDED
 *   reconcileStatedPrice  non-provisional only
 *   applyPricingMode      keeps provisional, DELETES non-provisional
 *
 * THEY ARE RIGHT TO DIFFER. Each is asking a different question, and forcing
 * them to agree would be wrong: a provisional sum is charged, so it belongs in
 * the customer's total; it is not part of the defined works, so a fixed price
 * does not cover it; and it survives a fixed-price collapse for exactly that
 * reason. The defect was never that the filters differ — it is that the
 * distinction was implicit and written out five times, so nothing could show
 * that they differ deliberately or check that they still agree.
 *
 * What that cost: quote 46e3d510 was accepted at £2,160 with £555.98 of drafted
 * work deleted, while reconcileStatedPrice compared £1,800 against a set that
 * excluded provisionals and found nothing to report. Three consumers, three
 * answers, no layer that owned the question.
 *
 * So this names the subsets rather than merging them. Each consumer now declares
 * which one it means, in the vocabulary of the domain, and
 * tests/regression/quote-lines-partition.test.ts pins the relationship between
 * them so they cannot drift apart silently.
 *
 * Pure filters, and deliberately importing nothing but the type: `sumLines`
 * lives in quote-math.ts beside `lineItemTotal`, because putting it here would
 * make two money modules import each other. ESM would tolerate the cycle — the
 * call happens at runtime, not module init — but a cycle between the file that
 * totals a quote and the file that decides which lines count is not one to rely
 * on the module graph to resolve.
 */

/**
 * Every line the customer is charged for — provisional sums included.
 *
 * A provisional sum is an estimate WITHIN the quote, not an exclusion from it:
 * it appears on the document, it is in the total, and the customer pays it
 * unless it is revised. This is the set VAT is computed on.
 */
export const chargedLines = (lineItems: LineItem[]): LineItem[] => lineItems;

/**
 * The defined works — everything except provisional sums.
 *
 * What a fixed price covers. A contractor saying "call it two grand" is pricing
 * the work they can see, not the allowance sitting beside it, so this is the set
 * a stated fixed amount is reconciled against. Including provisionals here would
 * fire on every correctly-built fixed quote that carries one.
 */
export const definedWorksLines = (lineItems: LineItem[]): LineItem[] =>
  lineItems.filter((item) => item.provisional !== true);

/**
 * The provisional sums alone.
 *
 * They price separately and stay editable, which is why they survive a
 * fixed-price collapse when the calculated breakdown does not.
 */
export const provisionalLines = (lineItems: LineItem[]): LineItem[] =>
  lineItems.filter((item) => item.provisional === true);

/**
 * Whether one line is a provisional sum.
 *
 * The same distinction as the set functions above, for the places that test a
 * single line rather than filter a list — the double-charge check walks lines
 * one at a time and cannot use a filter. Named so a reader sees it is the same
 * concept, not a coincidence of spelling.
 */
export const isProvisional = (item: LineItem): boolean => item.provisional === true;
