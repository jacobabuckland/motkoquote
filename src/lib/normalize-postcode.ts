/**
 * Normalizes a UK postcode to canonical form: uppercase, exactly one space
 * before the final three characters (the inward code), no surrounding whitespace.
 *
 * UK postcodes consist of:
 * - Outward code: 1-2 letters (area) + 1-2 digits (district) + optional letter
 * - Inward code: 1 digit (sector) + 2 letters (unit)
 *
 * Valid formats: A9 9AA, A99 9AA, AA9 9AA, AA99 9AA, A9A 9AA, AA9A 9AA
 *
 * Inputs that don't match the UK postcode pattern are returned unchanged (trimmed).
 * Whitespace-only inputs return an empty string.
 *
 * @example
 * normalizeUkPostcode("sw1a1aa") // "SW1A 1AA"
 * normalizeUkPostcode("m11ae") // "M1 1AE"
 * normalizeUkPostcode("  SW1A  1AA  ") // "SW1A 1AA"
 * normalizeUkPostcode("75008") // "75008" (not a UK postcode)
 * normalizeUkPostcode("   ") // ""
 */
export function normalizeUkPostcode(postcode: string): string {
  const trimmed = postcode.trim();
  if (!trimmed) return "";

  // Remove all whitespace to analyze the structure
  const noSpaces = trimmed.replace(/\s+/g, "");

  // UK postcode pattern: 1-2 letters, 1-2 digits, optional letter, then digit + 2 letters
  // Total length without spaces: 5-7 characters
  const ukPattern = /^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/i;

  if (!ukPattern.test(noSpaces)) {
    // Not a recognized UK postcode, return trimmed as-is
    return trimmed;
  }

  // Split into outward code (all but last 3 chars) and inward code (last 3 chars)
  const outward = noSpaces.slice(0, -3);
  const inward = noSpaces.slice(-3);

  return `${outward.toUpperCase()} ${inward.toUpperCase()}`;
}
