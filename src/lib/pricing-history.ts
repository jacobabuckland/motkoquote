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
 * a past QUOTE this contractor has already produced. Any one of them
 * gives the drafting model a real anchor, and gives the contractor something to
 * sanity-check an estimate against. None of them means the model is working
 * from nothing, and a figure produced from nothing is invented rather than
 * estimated — which is what D16 exists to keep off a customer document.
 *
 * Note what is NOT in the list: the contractor's day rate. That is what prices
 * labour, and labour has always gone unpriced without it. It says nothing about
 * what a bag of plaster costs.
 *
 * PFIX-4 replaced `similarPastJobs` with a COUNT OF PAST QUOTES. The old input
 * was whatever `findSimilarPastJobs` returned, and that retrieval filters on
 * contractor_id alone — so the one chunk written by the business-setup
 * interview came back as a "similar past job" and satisfied this on a
 * contractor's very first quote. On production, rate cards and confirmed
 * material prices were empty for EVERY contractor, so the guard this feeds was
 * off everywhere: every contractor-supplied material line was priced from a
 * number the model invented, with the contractor's markup applied on top.
 *
 * Counting quote-sourced chunks asks the question directly instead of
 * inferring it from what retrieval happened to rank. Note that it only means
 * what it says once quotes stop being embedded at DRAFT time — otherwise a
 * contractor's own first invented draft would teach the layer and then satisfy
 * this on their second. The two halves of PFIX-4 rely on each other.
 */
export const hasPricingHistory = (input: {
  knownMaterialPrices: CompileKnownPrice[];
  rateCards: CompileRateCard[];
  pastQuoteCount: number;
}): boolean =>
  input.knownMaterialPrices.length > 0 ||
  input.rateCards.length > 0 ||
  input.pastQuoteCount > 0;
