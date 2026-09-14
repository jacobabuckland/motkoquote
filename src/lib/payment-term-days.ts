/**
 * The contractor's stated payment terms, as a number of days — or null.
 *
 * WHY THIS IS DELIBERATELY NARROW. `invoice-due-date.ts` defaults to 14 days
 * and its comment gives the reason: `default_payment_terms` "is free prose
 * rendered into contract clauses … and deriving a number of days from prose
 * would mean guessing at the one figure that decides when a customer is told
 * they are late."
 *
 * That reasoning is right and this does not weaken it. What changed is the
 * premise: /setup now offers a fixed list — "On receipt", "7 days", "14 days",
 * "30 days" — so the common case is no longer prose at all, it is one of four
 * known strings. Reported 14 Sep: /setup said 7 days, the contract clause said
 * 7 days, and the invoice was raised due in 14. The trade's own document and
 * their invoice disagreed about when they expect to be paid.
 *
 * So this matches ONLY the shapes that list can produce, exactly, anchored at
 * both ends. Anything else returns null and the caller keeps the 14-day
 * default — including the legacy prose the original comment was written about:
 *
 *   "payment due within 30 days of invoice"  → null. Not "30". The sentence
 *                                               could as easily be about when
 *                                               the trade pays a supplier.
 *   "7 days from completion"                 → null. Which completion?
 *   "7 days"                                 → 7
 *   "On receipt"                             → 0
 *
 * The rule is that a term is read only when the whole field IS the term. A
 * number found inside a sentence is still a guess, and this still refuses to
 * make it.
 */
const BARE_DAYS = /^(\d{1,3})\s*days?$/;

export const paymentTermDays = (terms: string | null | undefined): number | null => {
  if (!terms) return null;

  const normalised = terms.trim().toLowerCase();
  if (normalised === "") return null;

  // Due the day it is sent. A real answer, and distinct from "not stated" —
  // which is why this returns 0 rather than falling through to null.
  if (normalised === "on receipt") return 0;

  const match = BARE_DAYS.exec(normalised);
  if (!match) return null;

  const days = Number(match[1]);
  // A term of 0 days is "on receipt" said differently and is accepted. A
  // negative one cannot be written by the regex, and an absurd one (999) is
  // the contractor's own choice from a free field — this reports what they
  // stated rather than second-guessing it.
  return Number.isInteger(days) ? days : null;
};
