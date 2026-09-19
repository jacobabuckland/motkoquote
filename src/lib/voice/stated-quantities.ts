/**
 * A count the contractor said with NO price beside it.
 *
 * THE GAP THIS FILLS, measured rather than assumed. `extractStatedPrices`
 * already carries a count whenever a price is stated alongside it (#796) —
 * every one of these yields `quantity: 8`:
 *
 *   "8 bags of finish at £12 each"              -> 8 x £12
 *   "eight bags of finish at twelve quid a bag" -> 8 x £12
 *
 * and every one of these yields NOTHING AT ALL:
 *
 *   "I need eight bags of finish"               -> []
 *   "I'll need about eight bags of finish"      -> []
 *
 * because the extractor is a price extractor, and there is no price. So an
 * unpriced count had nowhere structured to live. The intake model wrote it into
 * `materials_supply.quantity_guidance` as prose — "8 Finish bags at £12 each" —
 * which nothing downstream can read as a number, and the drafting model writes
 * the count into the DESCRIPTION and leaves `quantity` at 1. The customer is
 * billed for one bag of eight.
 *
 * That is the same undercharge #796 fixed for priced counts, arriving by the
 * other road. `quantity_guidance` keeps its prose — it still answers "or should
 * I work it out?", which no number can — and the number now travels beside it.
 *
 * WHAT IT DELIBERATELY DOES NOT READ, in each case because a wrong count is
 * worse than an absent one:
 *
 *  - A SENTENCE THAT STATES MONEY. `extractStatedPrices` owns those outright,
 *    and two readers over one sentence is how they come to disagree. The cost
 *    is a real miss — "eight bags of finish and a tub of primer at £27" loses
 *    the eight — and it is the cheap direction to be wrong in.
 *  - A UNIT OF MEASURE. "40 square metres of plasterboard" is the area of the
 *    WORK far more often than a count of boards, and multiplying a material
 *    line by 40 is the expensive direction.
 *  - A COUNT THAT CONTRADICTS ITSELF. "eight bags for the walls, four for the
 *    ceiling" means twelve, and no rule here can know that. Conflicting counts
 *    for one item cancel each other and neither is carried.
 *
 * Pure function, no API calls. Money integrity depends on determinism.
 */

import {
  COUNTABLE_UNIT,
  COUNT_WORDS,
  compoundCount,
  hasCurrencyMarker,
  splitIntoSentences,
} from "@/lib/voice/stated-prices";

/** A count the contractor stated, with the thing it counts. */
export interface StatedQuantity {
  /** The material named after the unit — "finish" in "eight bags of finish". */
  item: string;
  /** How many. Always a positive integer. */
  quantity: number;
  /** The unit as said, singular where it can be — "bag", "sheet". */
  unit: string;
  /** The sentence it was read from, so a flag can quote the contractor. */
  transcript_span: string;
}

const UNIT_WORD = new RegExp(`^(?:${COUNTABLE_UNIT})$`, "i");

/**
 * Words that make a count hypothetical or cancel it.
 *
 * "we won't need eight bags" and "if it's eight bags" are not statements of
 * quantity, and reading them as one bills for a job nobody agreed to.
 * Deliberately short: these are the forms a trade actually uses, and every
 * addition widens what gets silently dropped.
 */
const CANCELS_COUNT =
  /\b(?:no|not|don'?t|doesn'?t|won'?t|wouldn'?t|isn'?t|aren'?t|never|if|unless|maybe|might|whether)\b/i;

/** Strip the plural so "bags" and "bag" are the same unit. */
const singular = (unit: string): string =>
  /(?:s|es)$/i.test(unit) && !/ss$/i.test(unit)
    ? unit.replace(/es$/i, (m) => (/(?:box|ch|sh|x|z)es$/i.test(unit) ? "" : m.slice(1))).replace(/s$/i, "")
    : unit;

/**
 * The count at `i`, as digits or as words.
 *
 * Reads a compound whole ("twenty-six" -> 26) for the reason
 * `compoundCount`'s own comment gives: taking the word nearest the unit read
 * twenty-six bags as six and undercharged by two thirds, silently.
 */
const readCount = (words: string[], i: number): number | null => {
  const word = words[i];
  if (!word) return null;

  if (/^\d+$/.test(word)) {
    const n = Number.parseInt(word, 10);
    return n > 0 ? n : null;
  }

  const units = COUNT_WORDS[word.toLowerCase()];
  if (units === undefined) return null;

  const compound = compoundCount(words[i - 1], units >= 1 && units <= 9 ? units : null);
  return compound ?? units;
};

/**
 * The material a count is about: the words after "of", to the end of the
 * clause.
 *
 * "eight bags of finish for the bedrooms" is finish. Stopping at a preposition
 * matters more than it looks — carrying "for the bedrooms" into the item makes
 * it match a line about bedrooms rather than a line about plaster, which is
 * how a count lands on the wrong thing.
 *
 * With no "of", the unit IS the item: "eight sockets" counts sockets.
 */
const readItem = (words: string[], unitIdx: number, unit: string): string => {
  if (words[unitIdx + 1]?.toLowerCase() !== "of") return singular(unit);

  const tail: string[] = [];
  for (let j = unitIdx + 2; j < words.length; j += 1) {
    const w = words[j]!;
    if (/^(?:for|in|on|at|to|from|and|or|with|per|the|a|an)$/i.test(w) && tail.length > 0) break;
    if (/^(?:the|a|an)$/i.test(w) && tail.length === 0) continue;
    tail.push(w);
    if (tail.length >= 3) break;
  }

  return tail.length > 0 ? tail.join(" ") : singular(unit);
};

/**
 * Every unpriced count in a transcript, with conflicts removed.
 *
 * Returns at most one entry per item: an item counted twice with different
 * numbers is dropped entirely, per the header. An item counted twice with the
 * SAME number is one entry, because repeating yourself is not a conflict.
 */
export function extractStatedQuantities(transcript: string): StatedQuantity[] {
  if (!transcript || transcript.trim().length === 0) return [];

  const found: StatedQuantity[] = [];

  for (const sentence of splitIntoSentences(transcript)) {
    // Money in the sentence means the price extractor owns it. See the header.
    if (hasCurrencyMarker(sentence)) continue;
    if (CANCELS_COUNT.test(sentence)) continue;

    const words = sentence.replace(/[-]/g, " ").split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length; i += 1) {
      const bare = words[i]!.replace(/[^\w']/g, "");
      if (!UNIT_WORD.test(bare)) continue;

      const count = readCount(words.map((w) => w.replace(/[^\w']/g, "")), i - 1);
      if (count == null) continue;

      found.push({
        item: readItem(
          words.map((w) => w.replace(/[^\w']/g, "")),
          i,
          bare,
        ),
        quantity: count,
        unit: singular(bare),
        transcript_span: sentence.trim(),
      });
    }
  }

  const byItem = new Map<string, StatedQuantity | null>();
  for (const q of found) {
    const key = q.item.toLowerCase();
    const seen = byItem.get(key);
    if (seen === undefined) byItem.set(key, q);
    else if (seen !== null && seen.quantity !== q.quantity) byItem.set(key, null);
  }

  return [...byItem.values()].filter((q): q is StatedQuantity => q !== null);
}
