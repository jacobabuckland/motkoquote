// What a customer-facing quote says about a line the compiler could not price.
//
// The PDF renderer already said all of this (see lib/pdf/quote-pdf.tsx). The
// HTML quote page said none of it, and rendered the same line as £0.00 — so
// the two customer-facing views of one quote disagreed, and the one the
// customer actually opens from the link was the wrong one. These constants
// exist so the two surfaces can be compared, and so the wording is decided
// once. quote-pdf.tsx deliberately still carries its own literals: it is
// covered by golden baselines, and re-pointing it at these constants is a
// re-baseline that belongs in its own commit. A test asserts the strings match.

// The amount cell. Never "£0.00" — a zero here reads as "included at no
// charge", which is a commitment nobody made.
export const UNPRICED_AMOUNT_LABEL = "To be confirmed";

// The per-line explanation. "Estimated" is deliberately avoided: that is the
// marker for a real number that may move, and attaching it to an absent one
// only lends the absence credibility.
export const UNPRICED_LINE_NOTE =
  "Not priced: a rate for this work is still to be confirmed.";

// A total computed over a quote with an unpriced line covers only the lines
// that HAVE a price. Calling that "Total" claims a completeness the document
// does not have.
export const PARTIAL_TOTAL_LABEL = "Priced so far";

export const incompleteQuoteNote = (unpricedCount: number): string =>
  `This quote is not complete: ${unpricedCount} ${
    unpricedCount === 1 ? "item is" : "items are"
  } still to be priced and ${
    unpricedCount === 1 ? "is" : "are"
  } not included in the figure above.`;

// Shown in place of the Accept button. A customer cannot agree to a price that
// is not on the document, so the decision is withheld rather than captured.
export const UNPRICED_ACCEPT_BLOCKED =
  "This quote can't be accepted yet — part of it is still to be priced. " +
  "Your contractor has been asked to finish it.";

// Thrown by acceptQuote if the accept is attempted anyway.
export const UNPRICED_ACCEPT_REFUSED = "QUOTE_NOT_FULLY_PRICED";
