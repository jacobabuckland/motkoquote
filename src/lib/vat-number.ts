// UK VAT registration numbers: validation, normalisation, and what a document
// is allowed to print.
//
// Nothing validated this. `vat_number` was nullishString in the setup schema, a
// plain text input on the form, written straight through, and read unvalidated
// into every PDF header. A statement of work went to a customer reading
// "VAT 162512" — six digits, not a VAT number in any format. On a document
// whose whole job is to make a sole trader look like a business, an invalid VAT
// number does the opposite, and for a VAT-registered trade it is a compliance
// problem as well as a cosmetic one.
//
// Two accepted shapes, both real:
//   GB + 9 digits   — the standard registration
//   GB + 12 digits  — a branch trader (the 9-digit number plus a 3-digit suffix)
// Rejecting the 12-digit form would lock out legitimate registrations, which is
// worse than the invalid number this exists to catch.
//
// GD/HA numbers (government departments, NHS trusts) are deliberately not
// accepted: no contractor using this product holds one, and admitting the
// format would weaken the check for everyone who doesn't.
//
// Checksum validation is NOT performed. The failure here was a number that is
// not the right SHAPE, and a mod-97 check would reject typo'd-but-plausible
// numbers with no way for a contractor to override — a worse trade for the
// person whose real number our arithmetic happened to disagree with.

const VALID = /^GB(\d{9}|\d{12})$/;

/**
 * The canonical `GB…` form, or null when the input is not a UK VAT number.
 *
 * Forgiving about how it was typed — lowercase, spaces, dots and dashes are
 * stripped, and a bare number gets its GB prefix added — because those are
 * transcription habits, not wrong numbers. Strict about what it accepts.
 */
export const normalizeVatNumber = (input: string | null | undefined): string | null => {
  if (!input) return null;
  const stripped = input.toUpperCase().replace(/[\s.\-/]/g, "");
  const withPrefix = /^\d+$/.test(stripped) ? `GB${stripped}` : stripped;
  return VALID.test(withPrefix) ? withPrefix : null;
};

export const isValidVatNumber = (input: string | null | undefined): boolean =>
  normalizeVatNumber(input) !== null;

/**
 * What a customer-facing document may print for this contractor, or null.
 *
 * Null means the header omits the VAT line entirely. Omitting it is always
 * better than printing an invalid one: a missing VAT number reads as "not VAT
 * registered", which is unremarkable, while a malformed one reads as careless
 * at best and fabricated at worst.
 *
 * Existing rows hold whatever was typed before this check existed, so every
 * document path goes through here rather than trusting the stored column.
 */
export const vatNumberForDocument = (stored: string | null | undefined): string | null =>
  normalizeVatNumber(stored);
