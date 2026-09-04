/**
 * Deterministic parser for spoken British currency amounts.
 *
 * Parses natural spoken forms like "two eighty", "two hundred and eighty pounds",
 * "two pounds eighty", etc. into integer pence.
 *
 * Returns null for ambiguous or unparseable inputs — the voice flow must ask
 * for clarification rather than guessing.
 *
 * This is a PURE function — no API calls, no randomness, same input always
 * produces the same output. Money integrity depends on this being deterministic.
 */

// Word to number mappings
const ONES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  grand: 1000, // British slang for "thousand"
};

// Currency markers
const POUND_MARKERS = ["pound", "pounds", "quid", "£"];
const PENCE_MARKERS = ["pence", "p"];

/**
 * Parse a number word sequence into its numeric value.
 * e.g. "twenty three" -> 23, "two hundred and eighty" -> 280
 * Also handles digit strings like "280" -> 280
 * Also handles fractional multipliers like "seven and a half thousand" -> 7500
 */
function parseNumberWords(words: string[]): number | null {
  if (words.length === 0) return null;

  // Strip trailing "a" or "an" that aren't part of fractional patterns
  // (e.g., "three hundred pounds a" -> "three hundred pounds")
  // This handles rate units like "a day" that may have been included in extraction
  // Even if preceded by "and", a trailing "a"/"an" cannot form a fractional pattern
  // (e.g., "seven and a" has no "half"/"quarter" following), so always strip it.
  let processedWords = words;
  if (words.length > 0) {
    const lastWord = words[words.length - 1];
    if (lastWord === "a" || lastWord === "an") {
      processedWords = words.slice(0, -1);
    }
  }

  // Check if it's just a digit string
  if (processedWords.length === 1) {
    const parsed = parseInt(processedWords[0] ?? "", 10);
    if (!isNaN(parsed)) return parsed;
  }
  if (processedWords.length === 0) return null;

  let total = 0;
  let current = 0;

  for (let i = 0; i < processedWords.length; i++) {
    const word = processedWords[i];

    if (word === "and") {
      // Check for fractional multipliers: "and a half", "and a quarter", "and three quarters"
      const remaining = processedWords.slice(i + 1);

      // "and a half" or "and an half"
      if (remaining.length >= 2 &&
          (remaining[0] === "a" || remaining[0] === "an") &&
          remaining[1] === "half") {
        // Check that there's a scale word after the fraction
        if (remaining.length < 3 || (remaining[2] !== "hundred" && remaining[2] !== "thousand" && remaining[2] !== "grand")) {
          // No scale word after fraction - this is ambiguous
          return null;
        }
        const scale = remaining[2];
        const scaleValue = SCALES[scale] ?? 1000;
        if (current === 0) current = 1;
        // "seven and a half thousand" = (7 + 0.5) * 1000 = 7500
        const result = (current + 0.5) * scaleValue;
        total += result;
        current = 0;
        // Skip ahead past the fraction and scale word
        i += 3;
        continue;
      }

      // "and a quarter" or "and an quarter"
      if (remaining.length >= 2 &&
          (remaining[0] === "a" || remaining[0] === "an") &&
          remaining[1] === "quarter") {
        // Check that there's a scale word after the fraction
        if (remaining.length < 3 || (remaining[2] !== "hundred" && remaining[2] !== "thousand" && remaining[2] !== "grand")) {
          // No scale word after fraction - this is ambiguous
          return null;
        }
        const scale = remaining[2];
        const scaleValue = SCALES[scale] ?? 1000;
        if (current === 0) current = 1;
        // "one and a quarter thousand" = (1 + 0.25) * 1000 = 1250
        const result = (current + 0.25) * scaleValue;
        total += result;
        current = 0;
        // Skip ahead past the fraction and scale word
        i += 3;
        continue;
      }

      // "and three quarters"
      if (remaining.length >= 2 &&
          remaining[0] === "three" &&
          remaining[1] === "quarters") {
        // Check that there's a scale word after the fraction
        if (remaining.length < 3 || (remaining[2] !== "hundred" && remaining[2] !== "thousand" && remaining[2] !== "grand")) {
          // No scale word after fraction - this is ambiguous
          return null;
        }
        const scale = remaining[2];
        const scaleValue = SCALES[scale] ?? 1000;
        if (current === 0) current = 1;
        // "one and three quarters thousand" = (1 + 0.75) * 1000 = 1750
        const result = (current + 0.75) * scaleValue;
        total += result;
        current = 0;
        // Skip ahead past the fraction and scale word
        i += 3;
        continue;
      }

      // Regular "and" - skip it
      continue;
    }

    // Try parsing as a digit
    const asDigit = parseInt(word ?? "", 10);
    if (!isNaN(asDigit)) {
      current += asDigit;
      continue;
    }

    if (ONES[word] !== undefined) {
      current += ONES[word];
    } else if (TENS[word] !== undefined) {
      current += TENS[word];
    } else if (word === "hundred") {
      if (current === 0) current = 1; // "hundred" alone means 100
      current *= 100;
    } else if (word === "thousand" || word === "grand") {
      if (current === 0) current = 1; // "thousand"/"grand" alone means 1000
      total += current * 1000;
      current = 0;
    } else {
      // Unknown word
      return null;
    }
  }

  return total + current;
}

/**
 * Check if a phrase is ambiguous (could be interpreted multiple ways).
 * e.g. "two eighty five" could be £280.05 or £2.85
 */
function isAmbiguous(text: string): boolean {
  // Normalize the text
  const normalized = text
    .toLowerCase()
    .replace(/[£$.,]/g, "")
    .replace(/-/g, " ")
    .trim();

  // Pattern: "two eighty five" (three separate numbers with no clear separator)
  // This could be £280.05 or £2.85
  const words = normalized.split(/\s+/);

  // Check for the classic ambiguous pattern: number + tens + number
  // e.g. "two eighty five" - is it 280.05 or 2.85?
  if (words.length === 3) {
    const [first, second, third] = words;
    if (
      first &&
      second &&
      third &&
      (ONES[first] !== undefined || TENS[first] !== undefined) &&
      TENS[second] !== undefined &&
      ONES[third] !== undefined
    ) {
      // This is ambiguous unless there's a clear marker
      if (!normalized.includes("hundred") && !normalized.includes("and")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extract and parse a spoken money amount from text.
 *
 * Returns the amount in pence (integer), or null if the amount cannot be
 * confidently parsed.
 *
 * Examples:
 * - "two eighty" -> 28000 (£280.00)
 * - "two hundred and eighty pounds" -> 28000
 * - "two pounds eighty" -> 280 (£2.80)
 * - "two eighty five" -> null (ambiguous: £280.05 or £2.85?)
 * - "thirty five pence" -> 35
 * - "two thousand" -> 200000 (£2,000.00)
 */
export function parseSpokenMoneyAmount(text: string): number | null {
  if (!text || text.trim().length === 0) return null;

  // Check for ambiguous forms first
  if (isAmbiguous(text)) return null;

  // Normalize: lowercase, remove punctuation, handle hyphens
  const normalized = text
    .toLowerCase()
    .replace(/[£$.,]/g, "")
    .replace(/-/g, " ")
    .trim();

  const words = normalized.split(/\s+/);

  // Try to find currency markers
  const hasPoundMarker = words.some((w) => POUND_MARKERS.includes(w));
  const hasPenceMarker = words.some((w) => PENCE_MARKERS.includes(w));

  // Filter out currency marker words to get just the number words
  const numberWords = words.filter(
    (w) => !POUND_MARKERS.includes(w) && !PENCE_MARKERS.includes(w)
  );

  // Special case: "X pounds Y" or "X pound Y" format (e.g. "two pounds eighty")
  // This is unambiguous: pounds and pence
  const poundIndex = words.findIndex((w) => POUND_MARKERS.includes(w));
  if (poundIndex >= 0 && poundIndex < words.length - 1) {
    // We have words after "pounds/pound"
    const beforePound = words.slice(0, poundIndex).filter((w) => !PENCE_MARKERS.includes(w));
    const afterPound = words.slice(poundIndex + 1).filter((w) => !PENCE_MARKERS.includes(w));

    const poundsValue = parseNumberWords(beforePound);
    const penceValue = parseNumberWords(afterPound);

    if (poundsValue !== null && penceValue !== null) {
      return poundsValue * 100 + penceValue;
    }
  }

  // If we have a pence marker and no pound marker, it's just pence
  if (hasPenceMarker && !hasPoundMarker) {
    const value = parseNumberWords(numberWords);
    return value;
  }

  // Extract just the numeric words for pattern matching
  const justNumbers = numberWords.filter(
    (w) =>
      ONES[w] !== undefined ||
      TENS[w] !== undefined ||
      SCALES[w] !== undefined ||
      w === "and" ||
      !isNaN(parseInt(w, 10))
  );

  // Check for shorthand patterns FIRST before calling parseNumberWords

  // "two eighty" or "two eighty pounds" = £280
  // Pattern: ones + tens (optionally followed by "pounds")
  if (justNumbers.length === 2) {
    const [first, second] = justNumbers;
    if (
      first &&
      second &&
      ONES[first] !== undefined &&
      TENS[second] !== undefined
    ) {
      // This is shorthand: ones digit = hundreds, tens digit = tens
      // "two eighty" = 2*100 + 80 = 280 pounds
      const pounds = ONES[first] * 100 + TENS[second];
      return pounds * 100;
    }
  }

  // "eighty five ninety nine" = £85.99
  // Pattern: tens + ones + tens + ones
  if (justNumbers.length === 4) {
    const [a, b, c, d] = justNumbers;
    if (
      a &&
      b &&
      c &&
      d &&
      TENS[a] !== undefined &&
      ONES[b] !== undefined &&
      TENS[c] !== undefined &&
      ONES[d] !== undefined
    ) {
      // First two are pounds, last two are pence
      const pounds = TENS[a] + ONES[b];
      const pence = TENS[c] + ONES[d];
      return pounds * 100 + pence;
    }
  }

  // "two eighty five ninety nine" = £285.99
  // Pattern: ones + tens + ones + tens + ones
  if (justNumbers.length === 5) {
    const [a, b, c, d, e] = justNumbers;
    if (
      a &&
      b &&
      c &&
      d &&
      e &&
      ONES[a] !== undefined &&
      TENS[b] !== undefined &&
      ONES[c] !== undefined &&
      TENS[d] !== undefined &&
      ONES[e] !== undefined
    ) {
      // First three are pounds (hundreds + tens + ones), last two are pence
      const pounds = ONES[a] * 100 + TENS[b] + ONES[c];
      const pence = TENS[d] + ONES[e];
      return pounds * 100 + pence;
    }
  }

  // Otherwise, parse as a single number and determine if it's pounds or pence
  const value = parseNumberWords(numberWords);
  if (value === null) return null;

  // If explicitly marked as pounds, or >= 100 (implies pounds), convert to pence
  if (hasPoundMarker || value >= 100) {
    return value * 100;
  }

  // Can't confidently parse
  return null;
}
