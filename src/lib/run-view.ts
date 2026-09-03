import { lineItemTotal } from "@/lib/quote-math";
import { samePrice } from "@/lib/money-compare";
import type { LineItem } from "@/lib/schemas/job";

/**
 * The draft-versus-final comparison, and why it is not a diff.
 *
 * `drafted_line_items_json` holds the full calculated breakdown;
 * `line_items_json` holds the ACTIVE view, which `applyPricingMode` collapses
 * to a single works line in fixed mode. The two are therefore already unequal
 * the moment they are written, with no human involved.
 *
 * Reading that gap as deletions is not a hypothetical mistake. It is how a
 * review concluded that users were rejecting more than half of every drafted
 * quote: across the paired quotes on production, every one either matched
 * exactly or collapsed to a single line, and nine of the ten collapses were
 * this code path rather than a person. A viewer that renders the same
 * subtraction would reproduce the error on every job it displays, which is
 * worse than not showing it — a wrong number carries more conviction than an
 * absent one.
 *
 * So the comparison classifies before it counts.
 */
export type RunComparison =
  | { kind: "collapsed"; draftedCount: number; activeCount: number }
  | { kind: "identical"; count: number }
  | { kind: "edited"; draftedCount: number; activeCount: number; removed: string[]; added: string[] }
  | { kind: "no-draft"; activeCount: number };

const describe = (item: LineItem): string => item.description;

export const compareRun = (
  drafted: LineItem[] | null | undefined,
  active: LineItem[] | null | undefined,
): RunComparison => {
  const draftedItems = drafted ?? [];
  const activeItems = active ?? [];

  // A hand-typed quote has an empty stored breakdown. It was never drafted, so
  // there is nothing to compare and it must not land in the denominator of
  // anything — four of the twenty-three paired quotes on production are this.
  if (draftedItems.length === 0) {
    return { kind: "no-draft", activeCount: activeItems.length };
  }

  // The fixed-mode signature: many drafted lines, one active line. Named as a
  // collapse rather than counted as removals.
  if (draftedItems.length > 1 && activeItems.length === 1) {
    return {
      kind: "collapsed",
      draftedCount: draftedItems.length,
      activeCount: activeItems.length,
    };
  }

  const draftedDescriptions = draftedItems.map(describe);
  const activeDescriptions = activeItems.map(describe);
  const removed = draftedDescriptions.filter((d) => !activeDescriptions.includes(d));
  const added = activeDescriptions.filter((d) => !draftedDescriptions.includes(d));

  if (removed.length === 0 && added.length === 0) {
    return { kind: "identical", count: activeItems.length };
  }

  return {
    kind: "edited",
    draftedCount: draftedItems.length,
    activeCount: activeItems.length,
    removed,
    added,
  };
};

/**
 * Where a price the contractor SPOKE ended up.
 *
 * The viewer's whole reason to exist is the question "a stated price did not
 * reach the quote — where was it lost?", and answering it by eye means reading
 * a transcript, a SoW blob, a drafted breakdown and a final breakdown side by
 * side and holding four numbers in your head. This does the holding.
 *
 * The classification is deliberately three-way rather than a boolean, because
 * "not in the quote" has two completely different causes with two completely
 * different fixes: the extractor never turned the spoken amount into a line
 * (a drafting problem), or it did and the amount then disappeared (a pricing
 * mode, an edit, or the collapse above). A boolean sends you to the wrong half
 * of the pipeline half the time.
 */
export type StatedPriceTrace = {
  amount: number;
  item: string | null;
  span: string;
  /**
   * - `not-expected` — superseded, excluded or already paid: it is CORRECT for
   *   this amount to be absent, so it must not read as a loss.
   * - `in-final` — a final line carries it.
   * - `lost-at-drafting` — no drafted line ever carried it.
   * - `lost-after-drafting` — a drafted line carried it; no final line does.
   */
  stage: "not-expected" | "in-final" | "lost-at-drafting" | "lost-after-drafting";
  reason: string;
};

type PriceLike = {
  amount: number;
  item: string | null;
  transcript_span: string;
  superseded_by: number | null;
  qualifiers: { each: boolean; fitted: boolean; already_paid: boolean; excluded: boolean };
};

export const traceStatedPrices = (
  statedPrices: PriceLike[] | null | undefined,
  drafted: LineItem[] | null | undefined,
  active: LineItem[] | null | undefined,
): StatedPriceTrace[] =>
  (statedPrices ?? []).map((price) => {
    // Amounts are stored in integer pence; every line figure in the tree is
    // pounds. Convert once, here, rather than at each comparison.
    const pounds = price.amount / 100;
    const base = { amount: pounds, item: price.item, span: price.transcript_span };

    if (price.superseded_by !== null) {
      return {
        ...base,
        stage: "not-expected" as const,
        reason: `Superseded later in the call by £${(price.superseded_by / 100).toFixed(2)}.`,
      };
    }
    if (price.qualifiers.excluded) {
      return { ...base, stage: "not-expected" as const, reason: "Stated as out of scope." };
    }
    if (price.qualifiers.already_paid) {
      return { ...base, stage: "not-expected" as const, reason: "Stated as already paid." };
    }

    const inActive = (active ?? []).some((line) => samePrice(lineItemTotal(line), pounds));
    if (inActive) {
      return { ...base, stage: "in-final" as const, reason: "A final line carries this amount." };
    }

    const inDrafted = (drafted ?? []).some((line) => samePrice(lineItemTotal(line), pounds));
    if (inDrafted) {
      return {
        ...base,
        stage: "lost-after-drafting" as const,
        reason: "Drafted at this amount, but no final line carries it — check the pricing mode and any edits.",
      };
    }

    return {
      ...base,
      stage: "lost-at-drafting" as const,
      reason: "No drafted line ever carried this amount — it was lost between the transcript and the draft.",
    };
  });
