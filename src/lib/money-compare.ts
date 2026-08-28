/**
 * Amounts agreeing to within a penny are the same amount — compared as integer
 * pennies rather than against a float epsilon.
 *
 * `Math.abs(20.01 - 20) > 0.01` is TRUE in IEEE-754 (the difference computes as
 * 0.010000000000001563), so an epsilon comparison fires on a quote that is
 * exactly one penny out — the case the tolerance exists to absorb. Rounding
 * both sides to pennies first removes the class of error instead of tuning
 * around it. Money is integers; the float is only how it is stored.
 *
 * Extracted from stated-price-guard (#368) when #370 needed the identical
 * comparison. Two hand-written copies of a money predicate is how they drift.
 */
export const samePrice = (a: number, b: number): boolean =>
  Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= 1;
