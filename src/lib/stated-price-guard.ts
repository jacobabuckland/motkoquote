import { definedWorksLines, isProvisional } from "@/lib/quote-lines";
import { FIXED_PRICE_ABSORBED_PREFIX, absorbedByFixedPrice } from "@/lib/pricing-mode";
import { lineItemTotal, sumLines } from "@/lib/quote-math";
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

// The opening of every other failure `reconcileStatedPrice` can produce, each
// one used at its own push site rather than written out there. `withStatedPriceFlag`
// removes a stale flag by matching these, so a producer and its prefix drifting
// apart is precisely the accumulation bug — a kind whose opening is not in the
// list below is never removed, and every save appends a fresh copy beside the
// stale one.
//
// Constants make that drift a compile error instead of a silent one: a new
// failure kind cannot be pushed without a prefix, and a prefix cannot be
// reworded on one side only. `tests/regression/reconciliation-flag-hygiene.test.ts`
// closes the loop by exercising each kind through the real function and
// asserting the flag it produces is recognised.
export const DOUBLE_CHARGE_PREFIX = "Double-charge detected: ";
export const UNSOURCED_LINE_PREFIX = "Unsourced line: ";
export const AMOUNT_MISMATCH_PREFIX = "Amount mismatch: ";
export const DUPLICATE_AMOUNT_PREFIX = "Duplicate amount: ";
export const PROVISIONAL_DUPLICATES_PRICE_PREFIX = "Provisional sum repeats the fixed price: ";

/**
 * A provisional sum carrying the WHOLE stated fixed price.
 *
 * THE HOLE THIS CLOSES. Provisionals are excluded from every reconciliation in
 * this file — deliberately, because a fixed price covers the defined works and
 * not the allowance beside it — but they are NOT excluded from what the
 * customer pays. `chargedLines` includes them and VAT is computed on them. So a
 * provisional line is the one thing on a quote that no guard looks at and every
 * customer is billed for.
 *
 * Reported 15 Sep. The contractor said "the fixed price is £520". The draft
 * marked the defined works provisional AND priced it at £520, `applyPricingMode`
 * kept it beside the new works line, and the quote went to £1,040 net, £1,248
 * gross — exactly double:
 *
 *     General works — see Scope of work ........... £520.00
 *     Consumer unit replacement – fixed price ..... £520.00   (provisional)
 *     Waste removal ............................... £0.00     (provisional)
 *
 * Nothing caught it. `reconcileStatedPrice` compared £520 stated against £520 of
 * DEFINED works and agreed; the double-charge check skips provisional lines on
 * the reasoning that they are "not a charge". The quote reconciled with itself
 * while being twice the agreed price — wrong, and self-consistently wrong, which
 * is the shape a contractor cannot catch by glancing at a draft they did not
 * type. The same script produced a correct £624 quote on another run, so it is
 * non-deterministic and cannot be learned around.
 *
 * WHY IT FLAGS RATHER THAN DROPS THE LINE. Deleting priced work silently is the
 * failure this file already carries a scar from — quote 46e3d510 lost £555.98
 * that way. An allowance that happens to equal the fixed price is also a
 * legitimate if unusual quote. So the contractor is told, and the send is
 * blocked until they resolve it; nothing is removed on the code's own judgement.
 *
 * Exact equality is the duplicate's signature and is all this claims. A larger
 * allowance beside a small fixed price is unusual but coherent, and is left
 * alone.
 */
export const provisionalDuplicatesPriceFlag = (stated: number, description: string): string =>
  `${PROVISIONAL_DUPLICATES_PRICE_PREFIX}"${description}" is marked as a provisional ` +
  `sum and priced at £${stated.toFixed(2)}, which is the whole fixed price you set. ` +
  `It is being charged on top of the works line, so the quote is £${stated.toFixed(2)} ` +
  `more than you agreed. Remove the line if it IS the work, or correct its amount if ` +
  `it is a genuine allowance.`;

/**
 * The provisional lines that repeat the stated fixed price, if any.
 *
 * Pure, and exported so `sendQuote` can derive the block at the point of the
 * check rather than trusting a stored flag to be fresh — the lesson the unpriced
 * guards in `actions.ts` already learned.
 */
export const provisionalsRepeatingFixedPrice = (
  sow: Partial<Pick<SowState, "pricing">> | null | undefined,
  lineItems: LineItem[],
): LineItem[] => {
  const pricing = sow?.pricing;
  if (!pricing || pricing.mode !== "fixed") return [];
  const stated = pricing.fixed_amount;
  if (stated == null || stated <= 0) return [];
  return lineItems.filter(
    (item) => isProvisional(item) && samePrice(lineItemTotal(item), stated),
  );
};

export const statedPriceMismatchFlag = (stated: number, priced: number): string =>
  `${STATED_PRICE_MISMATCH_PREFIX}you set £${stated.toFixed(2)}, but the priced ` +
  `lines come to £${priced.toFixed(2)}. Check which is right before sending.`;

export const hasStatedPriceMismatchFlag = (
  flags: string[] | null | undefined,
): boolean =>
  (flags ?? []).some((flag) => flag.startsWith(STATED_PRICE_MISMATCH_PREFIX));

/**
 * The two figures back out of the mismatch message.
 *
 * Lives BESIDE the producer, and is round-tripped against it in
 * tests/regression/the-reconciler-offers-a-way-out.test.ts, so the format cannot
 * be reworded on one side only. Parsing this shape from anywhere else would be
 * asserting on prose; here it is one function's own output read by its neighbour.
 *
 * Why parse at all rather than emit a machine token like
 * NARRATIVE_TOTAL_CONFIRM_REQUIRED does: this string is not only a send error.
 * The same text is stored in contractor_flags_json and rendered to the
 * contractor in the editor, so it has to stay readable English. The other three
 * guards throw a token that is never persisted, which is why they can.
 *
 * Tolerates trailing failures: reconcileStatedPrice JOINS several kinds with a
 * space, so a mismatch can be followed by a double-charge or an unsourced line.
 */
export const parseStatedPriceMismatch = (
  message: string,
): { stated: number; priced: number } | null => {
  if (!message.includes(STATED_PRICE_MISMATCH_PREFIX)) return null;
  const match = message.match(
    /you set £(\d+(?:\.\d{2})?), but the priced lines come to £(\d+(?:\.\d{2})?)/,
  );
  if (!match) return null;
  const stated = Number(match[1]);
  const priced = Number(match[2]);
  if (!Number.isFinite(stated) || !Number.isFinite(priced)) return null;
  return { stated, priced };
};

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
      // THE DEFINED WORKS — provisionals excluded. A fixed price covers the
      // work the contractor could see, not the allowance beside it, so this is
      // deliberately a NARROWER set than the one computeQuoteTotals charges VAT
      // on. quote-lines.ts holds both and says why they differ.
      const priced = sumLines(definedWorksLines(lineItems));

      if (!samePrice(stated, priced)) {
        failures.push(statedPriceMismatchFlag(stated, priced));
      }

      // The provisionals the checks above deliberately ignore, in the one case
      // where ignoring them doubles the quote. See provisionalDuplicatesPriceFlag.
      for (const duplicate of provisionalsRepeatingFixedPrice(sow, lineItems)) {
        failures.push(provisionalDuplicatesPriceFlag(stated, duplicate.description));
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
        if (isProvisional(line)) return false;
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
            `${DOUBLE_CHARGE_PREFIX}"${task}" is included in the bundled line ` +
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
  const nonProvisionalLines = definedWorksLines(lineItems);

  // EVERY LINE THAT IS CHARGED, for the per-amount check below.
  //
  // A provisional sum is IN the subtotal — that is what a provisional sum is —
  // so a stated amount can land on one, and does. Excluding them made this
  // check answer the wrong question twice over:
  //
  //   * A stated £200 sitting on a £200 provisional line came back "no line at
  //     that value was found", which blocks the send on a correct quote. That
  //     is the same false refusal #793 fixed one arm over.
  //   * A price wrongly applied to TWO provisional lines came back the same
  //     way — absent rather than duplicated — so £414 of double-charged
  //     plaster carried no duplicate warning at all (job d2fa171f, 16 Sep).
  //
  // The UNSOURCED check above keeps the narrower set on purpose: a provisional
  // sum is a figure the model suggested, so it is unsourced by definition and
  // flagging every one of them would say nothing.
  const allChargedLines = lineItems;

  // Check every line has provenance
  const unsourcedLines = nonProvisionalLines.filter(
    (line) => !line.provenance || !line.provenance.source,
  );
  for (const line of unsourcedLines) {
    failures.push(
      `${UNSOURCED_LINE_PREFIX}"${line.description}" has no provenance. All lines must be sourced from the transcript or marked as contractor-added.`,
    );
  }

  // Check every stated amount maps to exactly one line
  // In fixed mode, stated prices are component prices from the transcript that
  // the contractor then rolled into a different total. The system-generated
  // works line represents that total, and stated prices not matching it are
  // legitimate. Skip this entire check in fixed mode when there's a
  // system-generated line present (the collapsed works line).
  const isFixedMode = pricing && pricing.mode === "fixed";
  const hasSystemGeneratedLine = nonProvisionalLines.some(
    (line) => line.provenance?.source === "system-generated",
  );

  if (!isFixedMode || !hasSystemGeneratedLine) {
    for (const statedPrice of activeStatedPrices) {
      // Convert from integer pence to pounds
      const statedAmount = statedPrice.amount / 100;

      // Find all lines matching this stated amount (within rounding tolerance).
      //
      // The line TOTAL is the right comparison for a lump sum — it absorbs
      // quantity, multiplier and people_count, which is why it was the only one.
      //
      // A PER-UNIT PRICE IS NOT A LINE TOTAL, and that became load-bearing the
      // moment stated prices started carrying the contractor's own count. "Eight
      // bags at eleven pounds a bag" used to reach a line of ONE bag, whose total
      // was £11 and matched the stated £11 by accident. Now the line is eight
      // bags totalling £88, nothing totals £11, and this raised
      //
      //     Amount mismatch: stated £11.00 for "finishing plaster"
      //     but no line at that value was found.
      //
      // on a line priced exactly as the contractor said it. That is a blocking
      // gate, not a note — the quote could not be sent — and it fired on every
      // per-unit line of all three quote runs on 16 Sep.
      //
      // So a price stated per unit is compared against the unit rate as well.
      // Lines carrying a crew breakdown are excluded from that arm: their
      // `unit_price` is a denormalised cache that `lineItemTotal` ignores
      // outright, so matching on it would be matching on a number the quote does
      // not charge.
      const matchingLines = allChargedLines.filter(
        (line) =>
          samePrice(lineItemTotal(line), statedAmount) ||
          (statedPrice.qualifiers.each &&
            !(line.people && line.people.length > 0) &&
            samePrice(line.unit_price, statedAmount)),
      );

      if (matchingLines.length === 0) {
        failures.push(
          `${AMOUNT_MISMATCH_PREFIX}stated £${statedAmount.toFixed(2)} for "${statedPrice.item ?? "item"}" but no line at that value was found.`,
        );
      } else if (matchingLines.length > 1) {
        failures.push(
          `${DUPLICATE_AMOUNT_PREFIX}stated £${statedAmount.toFixed(2)} appears on ${matchingLines.length} lines. Each stated amount must appear exactly once.`,
        );
      }
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
/**
 * Every distinct opening this function's output can have.
 *
 * `reconcileStatedPrice` JOINS several failure kinds into one string, so the
 * flag it returns begins with whichever kind happened to fail first. The
 * replacement below used to filter on `STATED_PRICE_MISMATCH_PREFIX` alone,
 * which is only one of the five — so whenever the first failure was any of the
 * others, the new flag carried no matching prefix, nothing was removed, and
 * each save appended a fresh copy beside the stale one.
 *
 * It is not hypothetical: quote `b3112196` on production carried eight flags
 * with one string repeated twice and another three times, which is how a
 * contractor learns to stop reading them. The code comment below promised the
 * flag "tracks the current state rather than accumulating history"; it held for
 * one case in five.
 *
 * Matching on the openings rather than giving every kind a shared prefix keeps
 * the contractor-facing wording exactly as it is — this fixes replacement, and
 * changes no copy.
 */
export const RECONCILIATION_FLAG_PREFIXES = [
  STATED_PRICE_MISMATCH_PREFIX,
  DOUBLE_CHARGE_PREFIX,
  UNSOURCED_LINE_PREFIX,
  AMOUNT_MISMATCH_PREFIX,
  DUPLICATE_AMOUNT_PREFIX,
  // B2.2. Registered here, not just produced, because withStatedPriceFlag
  // STRIPS every prefix in this list before re-adding what still applies. A
  // producer whose prefix is missing accumulates a fresh copy on every save —
  // the bug this list was created to fix — and one whose prefix is listed but
  // which is not re-computed gets silently dropped instead. Both failure modes
  // are why absorbedByFixedPrice is called from inside withStatedPriceFlag
  // rather than beside it.
  FIXED_PRICE_ABSORBED_PREFIX,
  PROVISIONAL_DUPLICATES_PRICE_PREFIX,
] as const;

export const isReconciliationFlag = (flag: string): boolean =>
  RECONCILIATION_FLAG_PREFIXES.some((prefix) => flag.startsWith(prefix));

export const withStatedPriceFlag = (
  flags: string[] | null | undefined,
  sow: Partial<Pick<SowState, "pricing" | "stated_prices">> | null | undefined,
  lineItems: LineItem[],
  /**
   * The CALCULATED breakdown, when the caller has it.
   *
   * Needed because reconcileStatedPrice reads the ACTIVE lines, and after a
   * fixed-price collapse those are the single works line at fixed_amount — it
   * compares the stated figure against itself and agrees. The value absorbed by
   * the collapse only exists in the breakdown, so a caller that has it passes it
   * and gets the absorbed flag too.
   *
   * Optional so a caller that genuinely has no breakdown (a legacy quote with no
   * drafted baseline) keeps working unchanged rather than being forced to invent
   * one.
   */
  calculatedLineItems?: LineItem[] | null,
): string[] => {
  const kept = (flags ?? []).filter((flag) => !isReconciliationFlag(flag));
  const mismatch = reconcileStatedPrice(sow, lineItems);
  const absorbed = calculatedLineItems
    // No cast. It used to read `sow as Pick<SowState, "pricing">`, which erased
    // the `| null | undefined` this parameter has always declared and handed a
    // null straight to a function that dereferenced it — see the note on
    // absorbedByFixedPrice, which now accepts nullish like reconcileStatedPrice
    // above it always has.
    ? absorbedByFixedPrice(sow, calculatedLineItems)
    : null;
  return [...kept, ...(mismatch ? [mismatch] : []), ...(absorbed ? [absorbed] : [])];
};
