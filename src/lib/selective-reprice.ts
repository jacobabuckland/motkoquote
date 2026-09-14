import type { LineItem } from "@/lib/schemas/job";

/**
 * Re-price only the lines the repair conversation actually changed.
 *
 * Criterion 6 of #726, and the sentence on the card it comes from:
 *
 *   "don't redraft — apply the deltas and re-price only what the conversation
 *    touched, leaving edited: true lines alone."
 *
 * Three review cycles could not settle this, because the two obvious readings
 * are both wrong and QA correctly rejected each:
 *
 *   Redraft everything, then restore edited prices.  A repair that fills in
 *     crew size re-prices the materials lines too, purely on model
 *     variability. The contractor sees figures move on lines nobody discussed.
 *
 *   Skip re-pricing entirely.  Then capturing the real crew size — the whole
 *     point of the repair — changes no labour price, and the quote keeps
 *     figures the model guessed while the SoW says otherwise.
 *
 * WHAT "INPUTS CHANGED" MEANS, operationally. A line's price is a function of
 * its own quantity, unit, multiplier, crew size and overtime flag. So a line's
 * inputs changed exactly when one of THOSE moved between the stored quote and
 * the redraft. If they are all identical and only `unit_price` differs, nothing
 * about that line changed — the model simply returned a different number, and
 * that is the variability the criterion exists to suppress.
 *
 * This needs no diff of the SoW and no map from slots to categories. It reads
 * the answer off the redraft itself, which is the only place the effect of the
 * conversation is actually visible.
 *
 * The three cases, in order of precedence:
 *
 *   1. `edited: true` on the stored line — the contractor set that price by
 *      hand and it survives regardless. Their work outranks both the model's
 *      old answer and its new one.
 *   2. A pricing input moved — take the new price. This is the case the repair
 *      exists to produce.
 *   3. Everything else — keep the stored price. The line was not discussed.
 *
 * A line the redraft introduced has no stored counterpart and takes its new
 * price; a stored line the redraft dropped is gone, because the conversation
 * changed the scope and a price once typed is not a reason to re-add work.
 */
const PRICING_INPUTS = ["quantity", "unit", "multiplier", "people_count", "overtime"] as const;

const inputsMoved = (stored: LineItem, drafted: LineItem): boolean =>
  PRICING_INPUTS.some((key) => stored[key] !== drafted[key]);

export const applySelectiveReprice = (
  drafted: LineItem[],
  stored: LineItem[],
): LineItem[] =>
  drafted.map((draftedLine) => {
    // Matched on description AND category. Line items carry no id, so identity
    // is reconstructed from what a person would recognise — and description
    // alone is not enough, because "Consumer unit" can legitimately appear once
    // as labour and once as materials. Matching on description alone would
    // carry one line's price onto the other.
    const storedLine = stored.find(
      (line) =>
        line.description === draftedLine.description && line.category === draftedLine.category,
    );

    // The repair added this line. Nothing to preserve.
    if (!storedLine) return draftedLine;

    // The contractor's own price, and it outranks everything.
    if (storedLine.edited) {
      return { ...draftedLine, unit_price: storedLine.unit_price, edited: true };
    }

    // This line's inputs moved, so the conversation touched it: take the new
    // price, and everything else the redraft says about it.
    if (inputsMoved(storedLine, draftedLine)) return draftedLine;

    // Untouched. Keep the price the quote already carried — the redraft's
    // figure here is noise, not news.
    return { ...draftedLine, unit_price: storedLine.unit_price };
  });
