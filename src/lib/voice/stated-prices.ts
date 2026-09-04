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
        return item;
      }
    }
  }

  return null;
}

/**
 * Detect qualifier keywords in the text around an amount.
 */
function detectQualifiers(text: string): {
  each: boolean;
  fitted: boolean;
  already_paid: boolean;
  excluded: boolean;
} {
  const lower = text.toLowerCase();

  return {
    each: /\beach\b/i.test(lower),
    fitted: /\bfitted\b/i.test(lower),
    already_paid: /already\s+(paid|settled)|they've\s+(?:already\s+)?paid|paid\s+(?:already|that)/i.test(lower),
    excluded: /not\s+included|that's\s+not\s+included|but\s+that's\s+not|excluded/i.test(lower),
  };
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
  const cleaned = sentence.replace(/[-.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(/\s+/);

  // Words that can be part of a money phrase
  // Note: "a" and "an" are now included to support fractional amounts
  // (e.g., "seven and a half thousand"). Rate units like "a day" are
  // caught by containsRateUnit() and marked as refused.
  const moneyWords = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|grand|pound|pounds|quid|pence|and|a|an|half|quarter|quarters|£|\d+)$/i;

  // Find the first money-related word
  // Skip "and" at the beginning - it's only valid in the middle of a phrase
  // (e.g., "five hundred and twenty"), not as the first word of the money phrase
  let startIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word && moneyWords.test(word)) {
      // Skip "and" at the start of the money phrase - keep looking for a real number word
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

  if (bestPhrase) {
    // Calculate character position of the start
    const beforeStart = words.slice(0, startIdx).join(' ');
    return {
      phrase: bestPhrase,
      startPos: beforeStart.length + (beforeStart.length > 0 ? 1 : 0),
    };
  }

  return null;
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
      const sentences = preprocessed.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
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
    const sentences = preprocessed.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    segments = sentences.map((text, idx) => ({ text, position: idx }));
  }

  for (const segment of segments) {
    let sentence = segment.text;
    if (!sentence) continue;

    // Preprocess: normalize British slang and common variations
    // "grand" → "thousand pounds"
    sentence = sentence.replace(/\b(\w+)\s+grand\b/gi, (match, num) => `${num} thousand pounds`);
    sentence = sentence.replace(/\bgrand\b/gi, 'thousand pounds');
    // "a hundred" → "one hundred", "a thousand" → "one thousand"
    sentence = sentence.replace(/\ba\s+(hundred|thousand)\b/gi, 'one $1');

    // PFIX-1: Fix £-digit forms by adding space between £ and digits
    // (Commas are already removed during sentence splitting)
    sentence = sentence.replace(/£\s*(\d)/g, '£ $1');

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

      // Remove the extracted phrase before processing to avoid re-extracting it
      const endPos = startPos + phrase.length;
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
      const qualifiers = detectQualifiers(sentence);

      // Check refusal on the LOCAL context around the phrase
      // This allows self-resolved ranges like "between X and Y, call it Z" where Z is clear
      const after = sentence.substring(phraseStart + phrase.length);
      const wordsAfter = after.trim().split(/\s+/).slice(0, 5).join(' ');
      const fullContext = `${wordsBefore} ${phrase} ${wordsAfter}`.trim();

      const refused = containsRange(fullContext) || containsHedge(fullContext) || containsRateUnit(fullContext);

      candidates.push({
        amount,
        item,
        transcript_span: sentence,
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
