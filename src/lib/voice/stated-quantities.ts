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
  FILLER_AND_CORRECTION_WORDS,
  hasCurrencyMarker,
  splitIntoSentences,
  turnsAreValid,
} from "@/lib/voice/stated-prices";
import type { TranscriptTurn } from "@/lib/voice-transcript";

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

/** A reading in progress: `corrects` decides conflicts and is not stored. */
type Reading = StatedQuantity & { corrects: boolean };

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

/**
 * Strip the plural so "bags" and "bag" are the same unit.
 *
 * Only a word whose "es" is the PLURAL ENDING loses both letters -- boxes,
 * batches, brushes. Everywhere else the "e" belongs to the word and only the
 * "s" comes off. Taking "es" off everything turned "tiles" into "til" and
 * "bundles" into "bundl", which then matched no line measured in tiles: a
 * spoken count refused for a unit mismatch that was an artefact of this
 * function rather than anything the contractor said.
 */
const singular = (unit: string): string => {
  if (!/s$/i.test(unit) || /ss$/i.test(unit)) return unit;
  return /(?:box|ch|sh|x|z)es$/i.test(unit) ? unit.slice(0, -2) : unit.slice(0, -1);
};

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
const FILLER = new Set(FILLER_AND_CORRECTION_WORDS);

/** Where or how, rather than what — see readItem for why this must not join a name. */
const PLACE_OR_MANNER =
  /^(?:upstairs|downstairs|outside|inside|out|up|down|there|here|overall|altogether|total|again|too|aswell|now|then|first|next|last|\w+ly)$/i;

/**
 * Units that hold a material rather than being one.
 *
 * "Eight sockets" counts sockets, and a socket is the thing being bought --
 * the unit IS the item, which is why `readItem` falls back to it. "Eight bags"
 * counts bags, and a bag is not a material. Nobody buys bags.
 *
 * Scenario 41, in all three of the 20 Sep recordings:
 *
 *   "I need 10 bags of finish. Sorry, make that 8 bags."
 *      -> finish = 10, and BAG = 8
 *
 * The correction never met the thing it corrected, because it was filed under
 * a different name. Both counts persisted, neither cancelled, neither
 * corrected, and the line kept the ten the contractor had just withdrawn. The
 * 19 Sep report filed this as ABBREVIATED-CORRECTION and rated it P2 on the
 * grounds that no money moved; the money moved once the rate found the line.
 */
const CONTAINER_UNIT =
  /^(?:bag|tub|tube|roll|box|pack|bundle|tin|drum|bucket|case|carton|lot|set)s?$/i;

const readItem = (words: string[], unitIdx: number, unit: string): string | null => {
  // No "of X". The unit is the item only where the unit is a thing -- a
  // socket, a tile, a door. A container names nothing; see CONTAINER_UNIT.
  if (words[unitIdx + 1]?.toLowerCase() !== "of") {
    return CONTAINER_UNIT.test(unit) ? null : singular(unit);
  }

  const tail: string[] = [];
  for (let j = unitIdx + 2; j < words.length; j += 1) {
    const w = words[j]!;
    const lower = w.toLowerCase();
    // A filler or correction word ENDS the name rather than joining it. The
    // 19 Sep tranche found both halves of what happens otherwise: "eight bags
    // of finish, actually make it ten" stored `finish actually make` = 8
    // beside `finish` = 10, and a readback stored `backing plaster just` = 6
    // beside `backing plaster` = 6. Both rules below key on the item name, so
    // one leaked word splits a material into two identities and the conflict
    // and duplicate checks stop firing -- silently, while the guard still
    // looks like it is working.
    if (FILLER.has(lower)) break;
    // A place or an adverb says WHERE or HOW, never what the material is.
    // "six bags of finish upstairs" is finish -- the same material as the
    // finish downstairs, which is what makes the two counts additive rather
    // than a conflict. Split into "finish upstairs" they stop being the same
    // item and the additive check goes quiet, which is the dangerous
    // direction: a count then attaches to a line it was never about.
    if (PLACE_OR_MANNER.test(lower)) break;
    // A BARE NUMBER IS NEVER PART OF A NAME -- #837's rule for the price
    // extractor's item, which this reader needed just as much.
    // "8 bags of Finish, 1 tub of Primer" stored the item as `Finish 1`: the
    // comma is gone by the time the words are read, so the next clause's count
    // walked straight into the name. Nothing then matched it -- `describesItem`
    // wants two shared significant words and a bare digit is not one -- so the
    // eight never reached the line and the quote shipped one bag of finish.
    // A name may CONTAIN digits ("2.5mm twin & earth"); it may not be one.
    if (/^\d+$/.test(w)) break;
    if (/^(?:for|in|on|at|to|from|and|or|with|per)$/i.test(w) && tail.length > 0) break;
    if (/^(?:the|a|an)$/i.test(w) && tail.length === 0) continue;
    tail.push(w);
    // Two words, not three. Material names are "finish", "backing plaster",
    // "multi finish" -- a third word is reaching into the rest of the clause.
    if (tail.length >= 2) break;
  }

  if (tail.length > 0) return tail.join(" ");

  // No "of X". The unit is the item only where the unit is a thing: a socket,
  // a tile, a door. A container names nothing, and the count belongs to
  // whatever was last named -- which the caller supplies, because only it has
  // read the sentences before this one.
  return CONTAINER_UNIT.test(unit) ? null : singular(unit);
};

/**
 * An explicit correction: the contractor replacing a count they just gave.
 *
 * The 19 Sep tranche settled this. Conflicting counts used to cancel each
 * other outright, which is right for "eight bags for the walls, four for the
 * ceiling" -- that means twelve, and no rule here can know it -- but wrong for
 * "eight bags of finish, actually make it ten", where the contractor has said
 * plainly which number stands. Refusing there leaves the line at 1 and
 * undercharges, having been told the answer.
 *
 * So a conflict resolves to the LAST count only when a correction marker
 * appears between the two, exactly as #826 lets a later ownership claim take
 * an item. Without a marker the counts still cancel, because additive is the
 * safer reading of two bare numbers.
 */
const CORRECTS_A_COUNT =
  /\b(?:actually|make\s+(?:it|that)|sorry|scratch\s+that|no\s+wait|i\s+mean|rather|instead|change\s+that)\b/i;

/**
 * Every unpriced count in a transcript, with conflicts removed.
 *
 * Returns at most one entry per item: an item counted twice with different
 * numbers is dropped entirely, per the header. An item counted twice with the
 * SAME number is one entry, because repeating yourself is not a conflict.
 */
export function extractStatedQuantities(
  transcript: string,
  turns?: TranscriptTurn[],
): StatedQuantity[] {
  if (!transcript || transcript.trim().length === 0) return [];

  // ONLY WHAT THE CONTRACTOR SAID, where the turns say who said it.
  //
  // `extractStatedPrices` has taken speaker-labelled turns since it was
  // written; this did not, and read the flat transcript whole. So Motko's own
  // readback -- "just six bags of backing plaster, got it" -- was counted as
  // contractor evidence, and the 19 Sep tranche caught it: one call persisted
  // the same six twice, once from the contractor and once from the echo.
  //
  // It is worse than a duplicate. An assistant that mishears a number reads
  // the WRONG one back, and that wrong number would arrive here indistinguish-
  // able from the contractor's own words. A count is only evidence from the
  // person who is being charged for it.
  //
  // Falls back to the flat transcript when turns are absent or in the legacy
  // July-2026 shape, which is what `turnsAreValid` tests and how the price
  // extractor behaves on the same input.
  const sources = turnsAreValid(turns)
    ? turns.filter((turn) => turn.speaker === "contractor").map((turn) => turn.text)
    : [transcript];

  const found: Reading[] = [];
  // The material most recently named, so an abbreviated count -- "make that 8
  // bags" -- reaches the thing it is about rather than inventing a new one.
  let lastNamed: string | null = null;

  for (const source of sources) {
    for (const sentence of splitIntoSentences(source)) {
      // Money in the sentence means the price extractor owns it. See the header.
      if (hasCurrencyMarker(sentence)) continue;
      if (CANCELS_COUNT.test(sentence)) continue;

      const words = sentence.replace(/[-]/g, " ").split(/\s+/).filter(Boolean);
      const bare = words.map((w) => w.replace(/[^\w']/g, ""));

      for (let i = 0; i < words.length; i += 1) {
        if (!UNIT_WORD.test(bare[i]!)) continue;

        const count = readCount(bare, i - 1);
        if (count == null) continue;

        // A bare container reaches back to the material last named. With
        // nothing named it is a count of nothing, which is not evidence of
        // anything and is dropped rather than guessed at.
        const named = readItem(bare, i, bare[i]!);
        const item = named ?? lastNamed;
        if (item === null) continue;
        if (named !== null) lastNamed = named;

        found.push({
          item,
          quantity: count,
          unit: singular(bare[i]!),
          transcript_span: sentence.trim(),
          corrects: CORRECTS_A_COUNT.test(sentence),
        });
      }
    }
  }

  const byItem = new Map<string, Reading | null>();
  for (const q of found) {
    const key = q.item.toLowerCase();
    const seen = byItem.get(key);
    if (seen === undefined || seen === null) {
      if (seen === undefined) byItem.set(key, q);
      // A cancelled item stays cancelled unless this one corrects it outright.
      else if (q.corrects) byItem.set(key, q);
      continue;
    }
    if (seen.quantity === q.quantity) continue;
    // Conflict. The later count wins only when it says so; otherwise both go.
    byItem.set(key, q.corrects ? q : null);
  }

  return [...byItem.values()]
    .filter((q): q is Reading => q !== null)
    .map(({ corrects: _corrects, ...rest }) => rest);
}
