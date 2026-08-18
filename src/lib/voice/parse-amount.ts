/**
 * Parses a spoken amount to integer pence. Returns null for ambiguous/unparseable input.
 * Examples:
 * - "two eighty" → 28000 (£280)
 * - "two hundred and eighty" → 28000
 * - "280 pounds" → 28000
 * - "two eighty five ninety-nine" → AMBIGUOUS → null (ask for clarification)
 * - "fifty pence" → 50
 * - "two pounds fifty" → 250
 */
export function parseSpokenAmount(transcript: string): number | null {
  if (!transcript || typeof transcript !== "string") {
    return null;
  }

  // Normalize: lowercase and trim
  let input = transcript.toLowerCase().trim();

  // Remove qualifiers like "about", "roughly", "around"
  input = input.replace(/\b(about|roughly|around)\s+/g, "");

  // Check for unparseable phrases
  if (input.includes("something") || input.includes("ish")) {
    return null;
  }

  // Check for unparseable patterns early

  // Detect "two eighty five ninety-nine" style ambiguity (too many number words without clear structure)
  // This is tricky - we need to allow "two hundred and eighty" but reject "two eighty five ninety-nine"
  if (input.match(/\b(eighty|ninety|twenty|thirty|forty|fifty|sixty|seventy)\s+(one|two|three|four|five|six|seven|eight|nine)\s+(eighty|ninety|twenty|thirty|forty|fifty|sixty|seventy)\s+(one|two|three|four|five|six|seven|eight|nine)/)) {
    return null; // Definitely ambiguous
  }

  // Parse for explicit currency markers
  const hasPounds = /\b(pounds?|quid)\b/.test(input);
  const hasPence = /\bpence\b/.test(input);

  // Check for standalone number without clear currency
  // e.g., "twenty" is ambiguous (twenty pounds or twenty pence?)
  const standalonePattern = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|\d+)$/;
  if (standalonePattern.test(input)) {
    return null; // Ambiguous
  }

  // Try to parse the amount
  const amount = parseAmountValue(input);
  if (amount === null) {
    return null;
  }

  // Apply currency interpretation
  if (hasPence && !hasPounds) {
    // "fifty pence" → 50 pence
    return amount;
  }

  if (hasPounds || input.includes("quid")) {
    // Check for "X pounds Y" pattern (e.g., "two pounds fifty", "two pounds eighty")
    // This matches patterns like "N pounds M" where M is the pence part
    const poundsAndPencePattern = /^(.+?)\s+pounds?\s+(?:and\s+)?(.+)$/;
    const match = input.match(poundsAndPencePattern);

    if (match && match[1] && match[2]) {
      const poundsPart = parseAmountValue(match[1]);
      const pencePart = parseAmountValue(match[2]);

      if (poundsPart !== null && pencePart !== null && pencePart < 100) {
        return poundsPart * 100 + pencePart;
      }
    }

    // Just "X pounds" → X * 100 pence
    return amount * 100;
  }

  // British convention: "two eighty" without explicit currency means £280, not £2.80
  // This applies when we have a pattern like "X Y" where X is 1-9 and Y is a tens word
  // e.g., "two eighty" = 280, "three fifty" = 350
  const twoPartPattern = /^(one|two|three|four|five|six|seven|eight|nine)\s+(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/;
  if (twoPartPattern.test(input)) {
    // "two eighty" → 2*100 + 80 = 280 pounds → 28000 pence
    const match = input.match(twoPartPattern);
    if (match) {
      const ones: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
      };
      const tens: Record<string, number> = {
        twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
      };
      const hundreds = ones[match[1]!] || 0;
      const tensValue = tens[match[2]!] || 0;
      const britishAmount = hundreds * 100 + tensValue;
      return britishAmount * 100; // Convert to pence
    }
  }

  // "two hundred and eighty" or similar full phrases → assume pounds
  if (input.includes("hundred") || input.includes("thousand")) {
    return amount * 100;
  }

  // If we parsed a number but have no clear currency indicator, it's ambiguous
  // unless it's a clear pattern we can interpret
  // Default to pounds for larger numbers (British convention)
  if (amount >= 100) {
    return amount * 100; // Assume pounds
  }

  // For smaller numbers without currency, it's ambiguous
  return null;
}

function parseAmountValue(input: string): number | null {
  if (!input) return null;

  const normalized = input.toLowerCase().trim();

  // Remove "and" connectors (e.g., "two hundred and eighty" → "two hundred eighty")
  const cleaned = normalized.replace(/\band\b/g, " ").replace(/\s+/g, " ").trim();

  // Try to parse as a direct number first
  if (/^\d+$/.test(cleaned)) {
    return parseInt(cleaned, 10);
  }

  // Word-to-number mapping
  const ones: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
  };

  const tens: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };

  const scales: Record<string, number> = {
    hundred: 100,
    thousand: 1000,
  };

  // Parse word by word
  const words = cleaned.split(/\s+/);
  let total = 0;
  let current = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (!word) continue;

    // Skip currency words and connectors
    if (word === "pounds" || word === "pound" || word === "pence" || word === "quid" || word === "a" || word === "the") {
      continue;
    }

    // Check if it's a digit
    if (/^\d+$/.test(word)) {
      const num = parseInt(word, 10);
      if (i > 0 && (words[i - 1] === "hundred" || words[i - 1] === "thousand")) {
        // This is likely an error or complex pattern, return null
        return null;
      }
      current += num;
      continue;
    }

    // Check ones
    if (word in ones) {
      current += ones[word]!;
      continue;
    }

    // Check tens
    if (word in tens) {
      current += tens[word]!;
      continue;
    }

    // Check scales (hundred, thousand)
    if (word in scales) {
      if (current === 0) {
        current = 1; // "a hundred" means one hundred
      }
      current *= scales[word]!;
      total += current;
      current = 0;
      continue;
    }

    // Unknown word - might be invalid input
    return null;
  }

  total += current;

  return total > 0 ? total : null;
}
