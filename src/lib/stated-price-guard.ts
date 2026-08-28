import { lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

// Reconciles the fixed price a contractor STATED against the figures the quote
// actually carries.
//
// Nothing did this. `pricing.fixed_amount` had four consumers and not one
// compared it to the quote: `agreedPriceDisagrees` compares the two *stored*
// price fields to each other and returns false when either is null, and
// `narrativeExceedsSubtotal` only fires when prose names a figure ABOVE the
// subtotal. So the two could diverge indefinitely with nothing noticing.
//
// Production carried the proof: a quote whose SoW said £5,000 and whose single
// works line read £5.00, sent unguarded and ACCEPTED at £6.00 gross. The
// mechanism was mundane — a switch to fixed seeded fixed_amount from the
// calculated subtotal, then the works line was edited directly, and
// updateQuoteLineItems writes line_items_json and total while never touching
// sow_json. Two stored figures for one job, free to drift apart forever.
//
// Pure and deterministic so every writer can assert the same invariant without
// a database.

/**
 * Amounts agreeing to within a penny are the same amount — compared as integer
 * pennies rather than against a float epsilon.
 *
 * `Math.abs(20.01 - 20) > 0.01` is TRUE in IEEE-754 (the difference computes as
 * 0.010000000000001563), so an epsilon comparison fires on a quote that is
 * exactly one penny out — the case the tolerance exists to absorb. Rounding
 * both sides to pennies first removes the class of error instead of tuning
 * around it. Money is integers; the float is only how it is stored.
 */
const samePrice = (a: number, b: number): boolean =>
  Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;

// Prefix rather than a whole constant: the flag names both figures, because the
// entire value of it is that the contractor sees WHICH two numbers disagree and
// can tell at a glance which one is wrong. Matching is on the prefix so the
// predicate does not have to re-derive the amounts.
export const STATED_PRICE_MISMATCH_PREFIX =
  "This quote doesn't add up to the fixed price on the job: ";

export const statedPriceMismatchFlag = (stated: number, priced: number): string =>
  `${STATED_PRICE_MISMATCH_PREFIX}you set £${stated.toFixed(2)}, but the priced ` +
  `lines come to £${priced.toFixed(2)}. Check which is right before sending.`;

export const hasStatedPriceMismatchFlag = (
  flags: string[] | null | undefined,
): boolean =>
  (flags ?? []).some((flag) => flag.startsWith(STATED_PRICE_MISMATCH_PREFIX));

/**
 * The flag for a quote whose priced lines disagree with its stated fixed price,
 * or null when there is nothing to report.
 *
 * Compared against the NET total of the non-provisional lines, not the whole
 * subtotal. A fixed price covers the defined works; provisional sums price
 * separately and remain editable (see applyPricingMode), so including them
 * would fire on every correctly-built fixed quote that carries one.
 *
 * Returns null unless the mode is actually "fixed" with a positive stated
 * amount. 'days' and 'calculated' have no stated total to honour, and a legacy
 * job with `pricing: null` must not change behaviour at all.
 */
export const reconcileStatedPrice = (
  sow: Pick<SowState, "pricing"> | null | undefined,
  lineItems: LineItem[],
): string | null => {
  const pricing = sow?.pricing;
  if (!pricing || pricing.mode !== "fixed") return null;

  const stated = pricing.fixed_amount;
  if (stated == null || stated <= 0) return null;

  const priced =
    Math.round(
      lineItems
        .filter((item) => item.provisional !== true)
        .reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;

  if (samePrice(stated, priced)) return null;
  return statedPriceMismatchFlag(stated, priced);
};

/**
 * Folds the reconciliation flag into a quote's contractor flags, replacing any
 * previous one.
 *
 * Replacing matters: a stale mismatch flag left behind after the figures were
 * corrected is worse than no flag, because it trains the contractor to ignore
 * it. Every writer of line_items_json or total runs this, so the flag tracks
 * the current state rather than accumulating history.
 */
export const withStatedPriceFlag = (
  flags: string[] | null | undefined,
  sow: Pick<SowState, "pricing"> | null | undefined,
  lineItems: LineItem[],
): string[] => {
  const kept = (flags ?? []).filter(
    (flag) => !flag.startsWith(STATED_PRICE_MISMATCH_PREFIX),
  );
  const mismatch = reconcileStatedPrice(sow, lineItems);
  return mismatch ? [...kept, mismatch] : kept;
};
