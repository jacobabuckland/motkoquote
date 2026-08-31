import { lineItemTotal } from "@/lib/quote-math";
import { samePrice } from "@/lib/money-compare";
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
 *
 * PRICE-4 extension: also performs per-amount reconciliation when stated_prices
 * exists. Every stated amount must map to exactly one line, and every line must
 * have provenance. The existing fixed-amount check runs alongside, not instead.
 */
export const reconcileStatedPrice = (
  sow: Partial<Pick<SowState, "pricing" | "stated_prices">> | null | undefined,
  lineItems: LineItem[],
): string | null => {
  // Collect all failures rather than returning on first
  const failures: string[] = [];

  // Existing fixed-amount check continues to run
  const pricing = sow?.pricing;
  if (pricing && pricing.mode === "fixed") {
    const stated = pricing.fixed_amount;
    if (stated != null && stated > 0) {
      const priced =
        Math.round(
          lineItems
            .filter((item) => item.provisional !== true)
            .reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
        ) / 100;

      if (!samePrice(stated, priced)) {
        failures.push(statedPriceMismatchFlag(stated, priced));
      }
    }
  }

  // D8: Double-charge detection — an item named in a bundled line's
  // includes_tasks should not also be charged as a separate line
  const bundledLines = lineItems.filter(
    (line) => line.includes_tasks && line.includes_tasks.length > 0,
  );

  for (const bundledLine of bundledLines) {
    for (const task of bundledLine.includes_tasks ?? []) {
      // Normalize for comparison: lowercase, trim, and normalize punctuation
      const normalizeForMatch = (text: string): string =>
        text
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .replace(/[&]/g, "and");

      const normalizedTask = normalizeForMatch(task);

      // Check if this task also appears as a separate charged line
      // Exclude provisional and unpriced lines (not real charges)
      const separateCharges = lineItems.filter((line) => {
        // Skip the bundled line itself
        if (line === bundledLine) return false;
        // Skip provisional lines (not a charge)
        if (line.provisional === true) return false;
        // Skip unpriced lines (not a charge)
        if (line.unpriced === true) return false;
        // Skip zero-amount lines that aren't actually charging
        if (line.unit_price === 0 && lineItemTotal(line) === 0) return false;

        const normalizedDesc = normalizeForMatch(line.description);

        // Fuzzy match: either string contains the other
        // This is conservative (under-matches) to avoid false rejections
        return normalizedTask.includes(normalizedDesc) || normalizedDesc.includes(normalizedTask);
      });

      if (separateCharges.length > 0) {
        for (const separateCharge of separateCharges) {
          failures.push(
            `Double-charge detected: "${task}" is included in the bundled line ` +
              `"${bundledLine.description}" but also charged separately as ` +
              `"${separateCharge.description}". Remove one or move the bundled item ` +
              `out of includes_tasks.`,
          );
        }
      }
    }
  }

  // Per-amount reconciliation (PRICE-4)
  const statedPrices = (sow as SowState | null | undefined)?.stated_prices;
  if (!statedPrices || statedPrices.length === 0) {
    // Legacy quote with no stated_prices — per-amount check does not fire
    // Return any accumulated failures (fixed-amount, double-charge), or null
    return failures.length > 0 ? failures.join(" ") : null;
  }

  // Filter to active stated prices (not superseded, excluded, or already_paid)
  const activeStatedPrices = statedPrices.filter(
    (sp) =>
      sp.superseded_by === null &&
      !sp.qualifiers.excluded &&
      !sp.qualifiers.already_paid,
  );

  // Non-provisional lines only (same as fixed-amount check)
  const nonProvisionalLines = lineItems.filter(
    (item) => item.provisional !== true,
  );

  // Check every line has provenance
  const unsourcedLines = nonProvisionalLines.filter(
    (line) => !line.provenance || !line.provenance.source,
  );
  for (const line of unsourcedLines) {
    failures.push(
      `Unsourced line: "${line.description}" has no provenance. All lines must be sourced from the transcript or marked as contractor-added.`,
    );
  }

  // Check every stated amount maps to exactly one line
  for (const statedPrice of activeStatedPrices) {
    // Convert from integer pence to pounds
    const statedAmount = statedPrice.amount / 100;

    // Find all lines matching this stated amount (within rounding tolerance)
    // Compare against line total, not unit_price, to handle quantity/multiplier/people_count
    const matchingLines = nonProvisionalLines.filter((line) =>
      samePrice(lineItemTotal(line), statedAmount),
    );

    if (matchingLines.length === 0) {
      failures.push(
        `Amount mismatch: stated £${statedAmount.toFixed(2)} for "${statedPrice.item ?? "item"}" but no line at that value was found.`,
      );
    } else if (matchingLines.length > 1) {
      failures.push(
        `Duplicate amount: stated £${statedAmount.toFixed(2)} appears on ${matchingLines.length} lines. Each stated amount must appear exactly once.`,
      );
    }
  }

  // Return all failures joined, or null if none
  return failures.length > 0 ? failures.join(" ") : null;
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
  sow: Partial<Pick<SowState, "pricing" | "stated_prices">> | null | undefined,
  lineItems: LineItem[],
): string[] => {
  const kept = (flags ?? []).filter(
    (flag) => !flag.startsWith(STATED_PRICE_MISMATCH_PREFIX),
  );
  const mismatch = reconcileStatedPrice(sow, lineItems);
  return mismatch ? [...kept, mismatch] : kept;
};
