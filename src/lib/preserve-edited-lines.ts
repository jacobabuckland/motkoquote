import type { LineItem } from "@/lib/schemas/job";

/**
 * A repair re-drafts the quote. The contractor's own prices must survive it.
 *
 * `redraftJob` rewrites line items wholesale, and a voice repair is the first
 * path that reaches a populated quote — one the contractor may have priced by
 * hand. `LineItem.edited` has existed for exactly this and was never used for
 * it. This is the rule that uses it: a line the contractor edited keeps the
 * price they set, and everything else takes the newly drafted one.
 *
 * MATCHED ON description AND category, deliberately. Line items carry no id,
 * so identity has to be reconstructed from what a person would recognise —
 * and description alone is not enough, because "Consumer unit" can legitimately
 * appear once as labour and once as materials. Matching on the pair keeps those
 * two apart; matching on description alone would carry one line's hand-set
 * price onto the other.
 *
 * A line the contractor edited and the redraft DROPPED is gone, and this does
 * not resurrect it. That is the correct reading: the repair conversation
 * changed the scope, so a line that no longer belongs in the quote should not
 * be re-added because someone once typed a price into it.
 *
 * Extracted from completeSowConversation rather than left inline so it can be
 * exercised directly. The frozen acceptance tests for this criterion assert
 * only `editedLineDescription === "Replace consumer unit"` — a const compared
 * with itself, which passes whether the rule works or not — and a frozen test
 * cannot be repaired. A test that can actually fail has to live somewhere, and
 * it lives beside this.
 */
export const preserveEditedLines = (
  drafted: LineItem[],
  existing: LineItem[],
): LineItem[] =>
  drafted.map((newLine) => {
    const existingLine = existing.find(
      (el) => el.description === newLine.description && el.category === newLine.category,
    );

    // `edited` is the contractor's mark, so only it protects a price. A line
    // that merely existed before is re-priced like any other — the repair is
    // allowed to change what the model produced, just not what a person did.
    if (existingLine?.edited) {
      return { ...newLine, unit_price: existingLine.unit_price, edited: true };
    }

    return newLine;
  });
