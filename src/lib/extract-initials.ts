/**
 * Extracts 1-2 initials from a company name.
 *
 * - Single word → 1 initial
 * - Two+ words → first 2 initials
 * - Handles non-letter characters by finding first two alphanumeric characters
 * - Returns empty string if no alphanumeric characters exist
 */
export function extractInitials(name: string): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "";
  }

  // Split by whitespace and hyphens to get word boundaries
  const words = trimmed.split(/[\s-]+/).filter((w) => w.length > 0);

  if (words.length === 0) {
    return "";
  }

  // Filter out single-character words (like "7" in "24 7")
  const substantialWords = words.filter((w) => w.length > 1);

  // If we have no substantial words, fall back to all words
  const wordsToUse = substantialWords.length > 0 ? substantialWords : words;

  if (wordsToUse.length === 1) {
    // Single substantial word: extract first 1-2 alphanumeric characters
    const alphanumerics = wordsToUse[0].match(/[a-z0-9]/gi);
    if (!alphanumerics) return "";

    // If it's the only word left after filtering single-char words,
    // and original had multiple words, take 2 chars
    if (substantialWords.length === 1 && words.length > 1) {
      return alphanumerics.slice(0, 2).join("").toUpperCase();
    }

    // Otherwise take 1 char (true single word)
    return alphanumerics[0].toUpperCase();
  }

  // Multi-word: get first alphanumeric from first two words
  const initials: string[] = [];

  for (let i = 0; i < Math.min(2, wordsToUse.length); i++) {
    const alphanumeric = wordsToUse[i].match(/[a-z0-9]/i);
    if (alphanumeric) {
      initials.push(alphanumeric[0].toUpperCase());
    }
  }

  return initials.join("");
}
