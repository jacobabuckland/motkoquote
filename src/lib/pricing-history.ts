// Whether a contractor has anything at all to ground a price estimate in
// (D15/D16 of the first-run intake work).
//
// Deliberately its OWN module rather than an export of compile-draft. That file
// is mocked wholesale by several frozen acceptance tests
// (tests/acceptance/quote-edit-status-guard.test.ts among them), so every new
// export added to it breaks a mock that cannot be repaired downstream. A
// separate module is also the better home: this is a question about the
// account, asked by the caller, not part of compiling a draft.

import type { CompileKnownPrice, CompileRateCard } from "./compile-draft";

/**
 * False means a genuine first run — no priced history of any kind.
 *
 * "History" is deliberately broad: a confirmed supplier price, a rate card, or
 * a past job similar enough to be retrieved for this scope. Any one of them
 * gives the drafting model a real anchor, and gives the contractor something to
 * sanity-check an estimate against. None of them means the model is working
 * from nothing, and a figure produced from nothing is invented rather than
 * estimated — which is what D16 exists to keep off a customer document.
 *
 * Note what is NOT in the list: the contractor's day rate. That is what prices
 * labour, and labour has always gone unpriced without it. It says nothing about
 * what a bag of plaster costs.
 */
export const hasPricingHistory = (input: {
  knownMaterialPrices: CompileKnownPrice[];
  rateCards: CompileRateCard[];
  similarPastJobs: string[];
}): boolean => {
  // At least one confirmed material price with an actual price figure
  const hasConfirmedMaterialPrice = input.knownMaterialPrices.some(
    (price) => price.unit_price > 0,
  );

  // At least one rate card with an actual rate
  const hasRateCard = input.rateCards.some((card) => card.rate_per_unit > 0);

  // At least one past job with actual price figures (£, $, or numbers in price context)
  const hasPastJobWithPrices = input.similarPastJobs.some((job) => {
    // Reject chunks containing unconfirmed or estimated prices
    const hasUnconfirmedIndicator = /(unconfirmed|model estimate)/i.test(job);
    if (hasUnconfirmedIndicator) {
      return false;
    }

    // Look for currency symbols or numbers that appear to be prices
    // Matches patterns like: £100, $50, 100.00, @£50, = £500, etc.
    const pricePattern = /[£$€][\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s*(?:each|per|day|hour|@)|@\s*[£$€]?[\d,]+/i;
    return pricePattern.test(job);
  });

  return hasConfirmedMaterialPrice || hasRateCard || hasPastJobWithPrices;
};
