/**
 * Extract structured stated prices from voice transcripts.
 *
 * PRICE-1 foundation: parses every monetary amount stated during the
 * conversation into a structured record. Changes no customer-facing output on
 * its own — PRICE-2 through PRICE-5 consume this record.
 *
 * Pure function — same input always produces same output, no API calls, no
 * randomness. Money integrity depends on determinism.
 */

import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { TranscriptTurn } from "@/lib/voice-transcript";
import { redactContactDetails } from "@/lib/voice/contact-detail-guard";

/**
 * A candidate amount found in the transcript, before supersession analysis.
 */
interface Candidate {
  amount: number;
  item: string | null;
  transcript_span: string;
  qualifiers: {
    each: boolean;
    fitted: boolean;
    already_paid: boolean;
    excluded: boolean;
  };
  // Position in transcript for ordering
  position: number;
  // Set when the extractor refuses to lock this amount
  refused: boolean;
}

/**
 * Detect if a sentence contains range indicators that make an amount ambiguous.
 * Ranges like "between X and Y", "X to Y", "X or Y" should be refused.
 */
function containsRange(text: string): boolean {
  const lower = text.toLowerCase();

  // "between X and Y" pattern
  if (/\bbetween\b.*\band\b/i.test(lower)) {
    return true;
  }

  // "X to Y" pattern (where both X and Y are likely amounts)
  // Look for "to" between number words or after an amount word
  if (/\b(hundred|thousand|pounds?|quid)\s+to\s+\b/i.test(lower)) {
    return true;
  }

  // "X or Y" pattern (where both are likely amounts)
  // Look for "or" between number words
  if (/\b(hundred|thousand|pounds?|quid)\s+or\s+\b/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Detect if a sentence contains hedge words that make an amount ambiguous.
 */
function containsHedge(text: string): boolean {
  const lower = text.toLowerCase();

  // Common hedge patterns
  const hedgePatterns = [
    /\baround\b/i,
    /\babout\b/i,
    /\bapproximately\b/i,
    /\bgive or take\b/i,
    /\bor so\b/i,
    /\broughly\b/i,
  ];

  return hedgePatterns.some(pattern => pattern.test(lower));
}

/**
 * Detect if a sentence contains rate unit indicators.
 * Rate units like "per day", "a day", "per hour" mean the amount is a rate, not a flat total.
 */
function containsRateUnit(text: string): boolean {
  const lower = text.toLowerCase();

  const ratePatterns = [
    /\ba day\b/i,
    /\bper day\b/i,
    /\bper hour\b/i,
    /\ban hour\b/i,
    /\bper metre\b/i,
    /\ba square metre\b/i,
    /\bper unit\b/i,
  ];

  return ratePatterns.some(pattern => pattern.test(lower));
}

/**
 * Detect if an amount is negated (e.g., "not five hundred", "no longer £300").
 * Checks if negation words appear in the immediate context before the amount.
 */
function isNegated(text: string): boolean {
  const lower = text.toLowerCase().trim();

  // Negation words that might appear before an amount
  // "not eight hundred", "no longer £300"
  if (/\bnot\s/i.test(lower) || /\bno\s/i.test(lower) || /\bno longer\b/i.test(lower) || /\bnever\b/i.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Check if extraction should be refused for this sentence.
 */
function shouldRefuseExtraction(text: string): boolean {
  return containsRange(text) || containsHedge(text) || containsRateUnit(text) || isNegated(text);
}

/**
 * Extract an item name from text around a monetary amount.
 * Looks for nouns/noun phrases that likely refer to what's being priced.
 */
function extractItem(fullSentence: string, amountPhrase: string): string | null {
  const lower = fullSentence.toLowerCase();
  const amountIndex = lower.indexOf(amountPhrase.toLowerCase());
  if (amountIndex === -1) return null;

  const beforeAmount = fullSentence.substring(0, amountIndex).trim();
  const afterAmount = fullSentence.substring(amountIndex + amountPhrase.length).trim();

  // Check "for [item]" pattern after the amount first
  // "five hundred and twenty for the consumer unit"
  const forAfterMatch = afterAmount.match(/^(?:for|on)\s+(?:the\s+)?(\w+(?:\s+\w+){0,2})/i);
  if (forAfterMatch && forAfterMatch[1]) {
    return forAfterMatch[1].trim();
  }

  // Common patterns before the amount
  const patterns = [
    // "X will be...", "X is...", "X was..."
    /(?:the\s+)?(\w+(?:\s+\w+){0,3}?)\s+(?:will\s+be|is|are|was|were)$/i,
    // "for X" or "for the X"
    /for\s+(?:the\s+)?(\w+(?:\s+\w+){0,2})$/i,
    // Last few words before amount
    /(\w+(?:\s+\w+){0,2})$/i,
  ];

  for (const pattern of patterns) {
    const match = beforeAmount.match(pattern);
    if (match && match[1]) {
      const item = match[1].trim();
      // Filter out filler words and correction phrases
      const stopWords = ["that", "this", "it", "they", "be", "will", "is", "are", "was", "were", "the", "a", "an", "of", "ll", "make", "make that", "actually", "sorry"];
      const itemLower = item.toLowerCase();
      if (stopWords.includes(itemLower)) continue;

      const words = itemLower.split(/\s+/);
      const filteredWords = words.filter(w => !stopWords.includes(w));
      if (filteredWords.length > 0) {
        return trimConnectors(item);
      }
    }
  }

  return null;
}

// Words that join an item to its price rather than naming any part of it.
const CONNECTORS = new Set([
  "at", "of", "for", "the", "a", "an", "and", "is", "are", "was", "were",
  "be", "will", "to", "in", "on", "with", "each", "that", "this", "it",
]);

/**
 * Strip joining words from BOTH ENDS of an extracted item name.
 *
 * The last of the patterns above takes the three words before the amount
 * verbatim, so "26 bags of finishing plaster at £10.80" yielded the item
 * "finishing plaster at" — and the trailing "at" is what stopped it matching a
 * line called "Finishing plaster". `matchStatedPriceByItem` tries an exact
 * match, then containment either way, then two shared significant words;
 * "finishing plaster at" fails containment because of the preposition, and
 * "of plaster at" contributes only ONE significant word, so it fails the
 * shared-word test too.
 *
 * A price that matches no item falls through to span matching, which refuses to
 * guess when several lines could share one sentence — and several materials
 * stated in one breath always do. The price then attaches to nothing and the
 * line is zeroed as unsourced. That is the mechanism behind materials arriving
 * at £0.00 on voice runs 01, 03 and 05: the prices WERE extracted, and every
 * one of them was thrown away at the join.
 *
 * Only the ends are trimmed. "tape and protection" keeps its middle "and",
 * because there the word is part of the name.
 */
function trimConnectors(item: string): string | null {
  const words = item.split(/\s+/).filter((w) => w.length > 0);
  while (words.length > 0 && CONNECTORS.has(words[0]!.toLowerCase())) words.shift();
  while (words.length > 0 && CONNECTORS.has(words[words.length - 1]!.toLowerCase())) words.pop();
  return words.length > 0 ? words.join(" ") : null;
}

/**
 * Detect qualifier keywords for ONE amount.
 *
 * `each` and `fitted` are read from `localAfter` — the few words that follow
 * this amount — rather than from the whole sentence. They attach to the amount
 * they trail, and a trades sentence routinely carries several amounts of which
 * only some are per-unit:
 *
 *   "26 bags of finishing plaster at £10.80 each, 8 bags of backing plaster at
 *    £14.50 each, 4 tubs of primer at £26 each, and one protection and
 *    consumables allowance of £95."
 *
 * Read sentence-wide, the £95 allowance — stated once, for the whole job —
 * came back `each: true`, and `applyStatedPrice` multiplies an `each` price by
 * the line's quantity. A four-unit line would have billed £380 for a £95
 * allowance. Voice runs 01, 03 and 05 each contained one of these: £95, a £65
 * tape-and-protection sum, and £160 of protection materials with £220 of waste
 * removal, all wrongly per-unit off the word "each" attached to a different
 * amount in the same breath.
 *
 * Only the words AFTER are consulted, never the ones before. "…at £28 each,
 * £160 protection materials" puts the previous amount's "each" three words in
 * FRONT of the £160, so a symmetric window would reproduce the bug it fixes.
 *
 * `already_paid` and `excluded` stay sentence-wide. They are claims about the
 * amount's status that a speaker attaches anywhere in the clause ("that's not
 * included", "they've already paid that"), and both are answered by SUPPRESSING
 * the line — so a false positive there loses a line rather than inflating one,
 * and narrowing them is a separate change with its own evidence to gather.
 */
function detectQualifiers(
  text: string,
  localAfter: string,
): {
  each: boolean;
  fitted: boolean;
  already_paid: boolean;
  excluded: boolean;
} {
  const lower = text.toLowerCase();
  const after = localAfter.toLowerCase();

  return {
    each: /\beach\b/i.test(after),
    fitted: /\bfitted\b/i.test(after),
    already_paid: /already\s+(paid|settled)|they've\s+(?:already\s+)?paid|paid\s+(?:already|that)/i.test(lower),
    excluded: /not\s+included|that's\s+not\s+included|but\s+that's\s+not|excluded/i.test(lower),
  };
}

/**
 * Units of MEASURE and of PACKAGING, the things a bare number in a trades
 * transcript is overwhelmingly counting rather than costing.
 *
 * Time units are deliberately absent. "two hundred and fifty a day" is a rate,
 * not a quantity, and `containsRateUnit` already refuses it — recording it as
 * a refusal is right, and dropping it silently would not be.
 */
const UNIT_AFTER_NUMBER =
  /^(?:sq(?:uare)?\s*(?:m|metres?|meters?)|lin(?:ear)?\s*(?:m|metres?|meters?)|sqm|m2|m|metres?|meters?|mm|millimetres?|cm|centimetres?|kg|kilos?|kilograms?|tonnes?|tons?|litres?|liters?|ft|feet|foot|inch(?:es)?|yards?|bags?|sheets?|tubs?|tubes?|rolls?|boxes|box|packs?|bundles?|lengths?|coats?|slabs?|tiles?|panels?|units?|doors?|windows?|sockets?|points?|radiators?)\b/i;

/**
 * True when the phrase states its own currency — the sign, or a pound or
 * pence word. A phrase that does is never reinterpreted as a quantity.
 */
function hasCurrencyMarker(phrase: string): boolean {
  return /£|\b(pounds?|quid|pence)\b/i.test(phrase);
}

/**
 * True when the words immediately after a number are a unit of measure.
 * Two words are considered, because the common ones are two words long
 * ("square metres", "linear metre").
 */
function followedByUnit(words: string[], numberEndIdx: number): boolean {
  const after = words.slice(numberEndIdx, numberEndIdx + 2).join(' ');
  return after.length > 0 && UNIT_AFTER_NUMBER.test(after);
}

/**
 * Extract the longest parseable money phrase from a sentence.
 * Uses a greedy approach: finds all number words, then tries to parse
 * increasingly larger spans until we get a valid parse.
 */
function extractBestMoneyPhrase(sentence: string): { phrase: string; startPos: number } | null {
  // Clean and split - remove punctuation that might stick to words
  // The hyphen is in this class deliberately. Without it "twenty-two" stays a
  // single token, matches no entry in `moneyWords`, and the scan below starts
  // at the next word that does — "thousand" — so "twenty-two thousand pounds"
  // extracted as £1,000 instead of £22,000. Measured: the spaced form
  // "twenty two thousand pounds" was already correct, which is what isolated it
  // to tokenisation rather than to parsing. `parseSpokenMoneyAmount` has
  // stripped hyphens all along; only this scan had not.
  //
  // It matters more than a written-English edge case: transcripts are machine
  // produced and transcribers hyphenate compound numbers as a matter of course,
  // so the hyphenated form is likely the common one. And the result was
  // chargeable rather than refused — a 22x understatement locked in as the
  // contractor's own stated price.
  //
  // The full stop is NOT in this class, and must not be put back. It was, and
  // it split "£10.80" into the tokens "£10" and "80" — the pence then read as
  // a whole-pound amount in its own right. By the time a sentence reaches
  // here, `splitIntoSentences` has already consumed every full stop that was
  // punctuation; the only ones left are flanked by digits, which is to say
  // they are decimal points and load-bearing.
  const cleaned = sentence.replace(/[-,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/);

  // Words that can be part of a money phrase
  // Note: "a" and "an" are now included to support fractional amounts
  // (e.g., "seven and a half thousand"). Rate units like "a day" are
  // caught by containsRateUnit() and marked as refused.
  const moneyWords = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|pound|pounds|quid|pence|and|a|an|half|quarter|quarters|£|\d+(?:\.\d{1,2})?)$/i;

  // Scan for a money phrase, advancing past anything that turns out not to be
  // one rather than giving up on the whole sentence at the first non-price
  // number.
  //
  // The old shape found the FIRST money word, tried it once, and returned null
  // if it did not parse — so the caller's extraction loop broke immediately.
  // "I'll be getting 26 bags of finishing plaster at £10.80 each" starts with
  // the quantity 26, which parses as nothing, and the sentence was abandoned
  // there with every real price in it unread. That went unnoticed only because
  // the decimal points were also splitting the sentence into fragments, each
  // of which happened to start after the previous quantity.
  let scanFrom = 0;
  while (scanFrom < words.length) {
    // Find the next money-related word.
    // Skip "and" at the start — it is only valid in the middle of a phrase
    // (e.g., "five hundred and twenty"), not as the first word.
    let startIdx = -1;
    for (let i = scanFrom; i < words.length; i++) {
      const word = words[i];
      if (word && moneyWords.test(word)) {
        if (word.toLowerCase() === 'and') {
          continue;
        }
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) return null;

    // Find the extent of consecutive money words
    let numberEndIdx = startIdx;
    for (let endIdx = startIdx; endIdx < words.length; endIdx++) {
      const word = words[endIdx];
      if (!word || !moneyWords.test(word)) {
        numberEndIdx = endIdx;
        break;
      }
      numberEndIdx = endIdx + 1;
    }

    // Where this candidate ends, so a rejected one can be stepped over.
    const nextScan = Math.max(startIdx + 1, numberEndIdx);

    // Always try the FULL extent of money words first
    // If that returns null, it's likely ambiguous (e.g., "two eighty five")
    // and we should NOT extract a partial phrase
    let bestPhrase: string | null = null;
    const fullPhrase = words.slice(startIdx, numberEndIdx).join(' ');
    const fullAmount = parseSpokenMoneyAmount(fullPhrase);

    if (fullAmount !== null) {
      // The full phrase parses successfully - use it
      bestPhrase = fullPhrase;
    }
    // If full phrase is null, do NOT try shorter variants -
    // it's either ambiguous or unparseable, and we should not extract a partial amount

    // If we didn't find a valid phrase, check if there's a qualifier like "each" or "fitted"
    // that suggests this is a pound amount even without an explicit marker
    if (!bestPhrase && numberEndIdx < words.length) {
      const nextWord = words[numberEndIdx];
      if (nextWord && /^(each|fitted)$/i.test(nextWord)) {
        // Try parsing the number phrase with "pounds" appended
        const numberPhrase = words.slice(startIdx, numberEndIdx).join(' ');
        const amount = parseSpokenMoneyAmount(numberPhrase + ' pounds');

        if (amount !== null) {
          bestPhrase = numberPhrase;
        }
      }
    }

    // A number carrying no currency marker, immediately followed by a unit, is
    // a QUANTITY. Step over it — it is not a price that we are declining to
    // lock, it is not a price at all, so it must not reach the record even as
    // a refusal.
    //
    // Without this, "We're skimming 148 square metres of walls" extracted
    // £148.00 with the item "re skimming", because `moneyWords` admits any
    // bare integer and the only thing standing between a bare integer and a
    // locked price was `containsRateUnit` — whose area pattern is the singular
    // article-led "a square metre" and matches no measurement anyone states.
    // Voice run 05 quoted a phantom £110 from "110 square metres".
    if (bestPhrase && !hasCurrencyMarker(bestPhrase) && followedByUnit(words, numberEndIdx)) {
      scanFrom = nextScan;
      continue;
    }

    if (bestPhrase) {
      // Calculate character position of the start
      const beforeStart = words.slice(0, startIdx).join(' ');
      return {
        phrase: bestPhrase,
        startPos: beforeStart.length + (beforeStart.length > 0 ? 1 : 0),
      };
    }

    scanFrom = nextScan;
  }

  return null;
}

/**
 * Split a passage into sentences WITHOUT cutting a decimal price in half.
 *
 * The naive `split(/[.!?]+/)` treated the point in "£10.80" as a full stop, so
 * a single spoken sentence about three materials arrived as three fragments:
 * "...finishing plaster at £10", "80 each, 8 bags of backing plaster at £14",
 * "50 each, 4 tubs of primer at £26 each". Each real price sat at the end of a
 * fragment with nothing after it, and each orphaned PENCE figure sat at the
 * start of the next one directly in front of the word "each" — which is the
 * one context that makes a bare number chargeable. Every price was lost and
 * two were invented: £80 each and £50 each, neither of them said by anyone.
 *
 * A point flanked by digits on both sides is never a sentence boundary, so it
 * is shielded before the split and restored after. This mirrors the comma
 * handling the callers already do for "£1,200", and is done as a substitution
 * rather than a lookbehind because tsconfig targets ES2017.
 */
const DECIMAL_SHIELD = "\u0000";

export function splitIntoSentences(text: string): string[] {
  return text
    .replace(/(\d)\.(\d)/g, `$1${DECIMAL_SHIELD}$2`)
    .split(/[.!?]+/)
    .map((s) => s.split(DECIMAL_SHIELD).join(".").trim())
    .filter((s) => s.length > 0);
}

/**
 * Check if turns have the required `at` field (new shape).
 * Legacy turns from July 2026 persist { speaker, text } without timestamps.
 */
function turnsAreValid(turns: TranscriptTurn[] | undefined): turns is TranscriptTurn[] {
  if (!turns || turns.length === 0) return false;
  // Check that all turns have the `at` field
  return turns.every(turn => turn.at !== undefined && turn.at !== null);
}

/**
 * Find all monetary amounts in the transcript with their context.
 * When speaker-labelled turns are provided and valid, only extracts from contractor turns.
 */
function findCandidates(transcript: string, turns?: TranscriptTurn[]): Candidate[] {
  const candidates: Candidate[] = [];

  // If turns are provided and valid, extract only from contractor turns
  const usesSpeakerFiltering = turnsAreValid(turns);

  // Build the list of text segments to extract from
  interface Segment {
    text: string;
    position: number;
  }

  let segments: Segment[];

  if (usesSpeakerFiltering && turns) {
    // Extract only from contractor turns, splitting each turn into sentences
    const contractorTurns = turns.filter(turn => turn.speaker === "contractor");
    segments = [];
    let positionCounter = 0;

    for (const turn of contractorTurns) {
      // PFIX-1: Remove commas from numbers BEFORE splitting (so "£1,200" stays together)
      const preprocessed = turn.text.replace(/(\d),(\d)/g, '$1$2');
      // Split each turn into sentences (NOT on commas, to keep hedges/qualifiers with amounts)
      const sentences = splitIntoSentences(preprocessed);
      for (const sentence of sentences) {
        segments.push({
          text: sentence,
          position: positionCounter++,
        });
      }
    }
  } else {
    // Fall back to flat transcript
    // PFIX-1: Remove commas from numbers BEFORE splitting
    const preprocessed = transcript.replace(/(\d),(\d)/g, '$1$2');
    // Split into sentences (NOT on commas)
    const sentences = splitIntoSentences(preprocessed);
    segments = sentences.map((text, idx) => ({ text, position: idx }));
  }

  for (const segment of segments) {
    let sentence = segment.text;
    if (!sentence) continue;

    // PFIX-9: blank out anything that is a contact detail rather than a price.
    //
    // Runs BEFORE the money-word test and the phrase extraction, because a
    // number early in a sentence otherwise becomes the candidate and hides a
    // genuine price later in the same one — "Ring me on 07700 900123, and the
    // skim is four hundred and fifty pounds" extracted £907,823 and lost the
    // £450 entirely. Redacting rather than rejecting means the existing
    // extractor finds the real price behind it, with nothing about parsing
    // changed (that is PFIX-1's territory, and stays there).
    sentence = redactContactDetails(sentence);

    // PFIX-12: Preserve the original redacted sentence for transcript_span.
    // The span must show verbatim text (after legitimate redaction), not the
    // normalized form used for parsing. Contact-detail redaction stays in the
    // span; normalization does not.
    const originalRedactedSentence = sentence;

    // Preprocess: normalize British slang and common variations FOR PARSING
    // "grand" → "thousand pounds"
    sentence = sentence.replace(/\b(\w+)\s+grand\b/gi, (match, num) => `${num} thousand pounds`);
    sentence = sentence.replace(/\bgrand\b/gi, 'thousand pounds');
    // "a hundred" → "one hundred", "a thousand" → "one thousand"
    sentence = sentence.replace(/\ba\s+(hundred|thousand)\b/gi, 'one $1');

    // PFIX-1: Fix £-digit forms by adding space between £ and digits
    // (Commas are already removed during sentence splitting)
    sentence = sentence.replace(/£\s*(\d)/g, '£ $1');

    // Check if sentence has number words or currency markers
    if (!/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|pound|pounds|quid|pence|£|\d+)\b/i.test(sentence)) {
      continue;
    }

    // PFIX-1: Extract multiple amounts from the same sentence (for self-resolved ranges)
    // Keep extracting until no more amounts are found
    let remainingSentence = sentence;
    const extractedAmounts: number[] = [];

    while (remainingSentence.length > 0) {
      const result = extractBestMoneyPhrase(remainingSentence);
      if (!result) break;

      const { phrase, startPos } = result;

      // Try parsing the phrase directly
      let amount = parseSpokenMoneyAmount(phrase);

      // If that didn't work, try with "pounds" appended (for cases like "eighty five each")
      if (amount === null) {
        amount = parseSpokenMoneyAmount(phrase + ' pounds');
      }

      // Remove the extracted phrase before processing to avoid re-extracting it.
      //
      // `startPos` is an offset into the CLEANED sentence, which has had its
      // punctuation replaced and its whitespace collapsed, so it drifts from
      // this string by however many characters that removed. Locating the
      // phrase here instead keeps the cut exact. When the drift ran backwards
      // the cut landed inside the next number: "£14.50 each" was re-entered at
      // "50 each" and extracted a second, invented £50.
      const found = remainingSentence.toLowerCase().indexOf(phrase.toLowerCase());
      const endPos = found >= 0 ? found + phrase.length : startPos + phrase.length;
      remainingSentence = remainingSentence.substring(endPos);

      // If not parseable, continue
      if (amount === null) continue;

      // Avoid duplicate amounts (might be extracted slightly differently)
      if (extractedAmounts.includes(amount)) continue;
      extractedAmounts.push(amount);

      // PFIX-1: Check for negation - don't add negated amounts
      // "not five hundred" is not a stated price
      const phraseStart = sentence.toLowerCase().indexOf(phrase.toLowerCase());
      const before = sentence.substring(0, phraseStart);
      const wordsBefore = before.trim().split(/\s+/).slice(-3).join(' ');
      const beforeContext = `${wordsBefore} ${phrase}`.trim();

      if (isNegated(beforeContext)) {
        // Skip negated amounts - they're explicitly what the price is NOT
        continue;
      }

      const item = extractItem(sentence, phrase);

      const after = sentence.substring(phraseStart + phrase.length);
      const wordsAfter = after.trim().split(/\s+/).slice(0, 5).join(' ');

      // `each`/`fitted` belong to THIS amount, so they are read from the words
      // that trail it, not from the sentence — see detectQualifiers.
      const qualifiers = detectQualifiers(sentence, wordsAfter);

      // Check refusal on the LOCAL context around the phrase
      // This allows self-resolved ranges like "between X and Y, call it Z" where Z is clear
      const fullContext = `${wordsBefore} ${phrase} ${wordsAfter}`.trim();

      const refused = containsRange(fullContext) || containsHedge(fullContext) || containsRateUnit(fullContext);

      candidates.push({
        amount,
        item,
        transcript_span: originalRedactedSentence,
        qualifiers,
        position: segment.position,
        refused,
      });
    }
  }

  return candidates;
}

/**
 * Normalize item names for comparison (case-insensitive, whitespace-normalized).
 */
function normalizeItem(item: string | null): string {
  if (!item) return "";
  return item.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Check if two items refer to the same thing.
 * Uses fuzzy matching: items match if one contains the other.
 * Requires at least 2 shared significant words for standalone matching.
 */
function itemsMatch(item1: string | null, item2: string | null): boolean {
  if (!item1 || !item2) return false;

  const norm1 = normalizeItem(item1);
  const norm2 = normalizeItem(item2);

  // Exact match
  if (norm1 === norm2) return true;

  // One contains the other (e.g., "consumer unit" vs "consumer unit labour")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // For standalone word matching, require at least 2 shared significant words
  // This prevents "consumer unit labour" from matching "labour for first fix"
  const words1 = norm1.split(/\s+/).filter(w => w.length >= 3);
  const words2 = norm2.split(/\s+/).filter(w => w.length >= 3);

  if (words1.length === 0 || words2.length === 0) return false;

  const shared = words1.filter(w => words2.includes(w));
  // Require at least 2 shared words
  return shared.length >= 2;
}

/**
 * Identify supersessions: when a contractor corrects a previously stated amount.
 *
 * Detection strategy:
 * - Same item (fuzzy matched) mentioned with different amounts
 * - Later amounts supersede earlier ones for the same item
 * - An amount restated identically is NOT a supersession
 * - Amounts with no item that appear between amounts with the same item
 *   are assumed to belong to that item (e.g., corrections like "no, five hundred")
 */
function identifySupersessions(candidates: Candidate[]): StatedPrice[] {
  // Group by item, using fuzzy matching
  const groups: Candidate[][] = [];
  const unattached: Candidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.item) {
      // Check if this unattached amount appears between two amounts with matching items
      // (likely a correction like "£400... no, £500")
      let attachedToGroup = false;

      for (const group of groups) {
        if (group.length > 0) {
          // Check if this candidate's position is near this group's positions
          const groupPositions = group.map(c => c.position);
          const minPos = Math.min(...groupPositions);
          const maxPos = Math.max(...groupPositions);

          // If within 2 positions of the group, assume it belongs to it
          if (candidate.position >= minPos - 2 && candidate.position <= maxPos + 2) {
            group.push(candidate);
            attachedToGroup = true;
            break;
          }
        }
      }

      if (!attachedToGroup) {
        unattached.push(candidate);
      }
      continue;
    }

    // Find existing group that matches this item
    let found = false;
    for (const group of groups) {
      if (group.length > 0 && itemsMatch(group[0]!.item, candidate.item)) {
        group.push(candidate);
        found = true;
        break;
      }
    }

    if (!found) {
      groups.push([candidate]);
    }
  }

  const results: StatedPrice[] = [];

  // Process each item group
  for (const group of groups) {
    // Sort by position in transcript
    group.sort((a, b) => a.position - b.position);

    // Find unique amounts (dedupe exact restatements)
    const uniqueAmounts: Candidate[] = [];
    for (const candidate of group) {
      const existingIdx = uniqueAmounts.findIndex(
        u => u.amount === candidate.amount
      );

      if (existingIdx === -1) {
        // New amount for this item
        uniqueAmounts.push(candidate);
      }
      // If amount already seen, skip (it's a restatement, not a correction)
    }

    // If multiple unique amounts for same item, earlier ones are superseded
    if (uniqueAmounts.length > 1) {
      // All but the last are superseded
      for (let i = 0; i < uniqueAmounts.length - 1; i++) {
        const superseded = uniqueAmounts[i]!;
        const supersededBy = uniqueAmounts[uniqueAmounts.length - 1]!;

        results.push({
          amount: superseded.amount,
          item: superseded.item,
          transcript_span: superseded.transcript_span,
          qualifiers: superseded.qualifiers,
          superseded_by: supersededBy.amount,
          refused: superseded.refused,
        });
      }

      // The last one is current (not superseded)
      const current = uniqueAmounts[uniqueAmounts.length - 1]!;
      results.push({
        amount: current.amount,
        item: current.item,
        transcript_span: current.transcript_span,
        qualifiers: current.qualifiers,
        superseded_by: null,
        refused: current.refused,
      });
    } else {
      // Only one amount for this item, not superseded
      const candidate = uniqueAmounts[0]!;
      results.push({
        amount: candidate.amount,
        item: candidate.item,
        transcript_span: candidate.transcript_span,
        qualifiers: candidate.qualifiers,
        superseded_by: null,
        refused: candidate.refused,
      });
    }
  }

  // Add unattached amounts (no clear item)
  for (const candidate of unattached) {
    results.push({
      amount: candidate.amount,
      item: null,
      transcript_span: candidate.transcript_span,
      qualifiers: candidate.qualifiers,
      superseded_by: null,
      refused: candidate.refused,
    });
  }

  return results;
}

/**
 * Extract every stated price from a transcript into a structured record.
 *
 * Returns an array of StatedPrice objects, or an empty array if no amounts found.
 * Pure function — same input always produces same output.
 *
 * When speaker-labelled turns are provided and valid (have the `at` field),
 * only contractor turns are considered for price extraction. Assistant turns
 * are ignored for price extraction but may still inform item matching or context.
 *
 * When turns are absent or in an older shape (missing the `at` field), falls
 * back to current behavior: extracting from the flat transcript with no speaker
 * distinction.
 *
 * @param transcript The conversation transcript to extract from
 * @param turns Optional speaker-labelled turns from conversation_json
 * @returns Array of stated prices (empty if none found)
 */
export function extractStatedPrices(
  transcript: string,
  turns?: TranscriptTurn[]
): StatedPrice[] {
  if (!transcript || transcript.trim().length === 0) {
    return [];
  }

  const candidates = findCandidates(transcript, turns);

  if (candidates.length === 0) {
    return [];
  }

  return identifySupersessions(candidates);
}

/**
 * Get chargeable stated prices: non-superseded, non-excluded, non-already_paid, non-refused.
 *
 * These are the prices that should actually appear as line items on the quote.
 * Used by compile-draft.ts to apply locked amounts.
 *
 * @param statedPrices All stated prices from extraction
 * @returns Only the prices that should become chargeable line items
 */
export function getChargeableStatedPrices(statedPrices: StatedPrice[]): StatedPrice[] {
  return statedPrices.filter((price) => {
    // Superseded prices don't appear on the quote
    if (price.superseded_by !== null) return false;

    // Already paid items don't appear as chargeable lines
    if (price.qualifiers.already_paid) return false;

    // Excluded items don't appear on the quote
    if (price.qualifiers.excluded) return false;

    // PFIX-1: Refused extractions (ambiguous amounts) don't become chargeable
    if (price.refused) return false;

    return true;
  });
}
