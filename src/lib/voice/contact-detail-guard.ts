// Stopping a spoken contact detail from becoming a price.
//
// Found on the 3 Sep live diagnostic call. From job 30faef2a's transcript:
//
//     "Yeah, the contact number is 07479 556410"   ->  £563,889.00
//
// The amount is not even the digits spoken: `\d+` is a money word, so the
// number became the candidate phrase and parseSpokenMoneyAmount invented a
// figure from it. The reconciliation gate then correctly observed that no line
// carries £563,889 and raised a flag — so the quote could not be sent over a
// price nobody stated. The gate was right; it was fed a fabrication.
//
// The second half is worse and the card did not know about it. Candidates are
// found one per SENTENCE, from the FIRST money-word run, so a number early in a
// sentence hides a real price later in the same one:
//
//     "Ring me on 07700 900123, and the skim is four hundred and fifty pounds."
//       ->  £907,823   (and the £450 never extracted at all)
//
// So redaction, not rejection. Blanking the contact detail out of the sentence
// lets the existing extractor find the genuine price behind it, with no change
// to how anything is parsed — which keeps this out of PFIX-1's territory and
// keeps the diff to one import and one call.
//
// Pure and deterministic.

// Words that introduce a contact detail. After any of these, a digit run is a
// number to ring, not a number to charge.
const CONTACT_CUES =
  /\b(number|numbers|mobile|phone|telephone|landline|call|calling|ring|text|txt|whatsapp|email|e-mail|postcode|post code|code|reference|ref|account)\b/i;

// A UK postcode, spoken or written. Never a price.
const POSTCODE =
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

/**
 * A run of digits, optionally broken by spaces, hyphens or brackets — the shape
 * a phone number takes however it was transcribed.
 */
const DIGIT_RUN = /[\d][\d\s()+-]*[\d]|\d/g;

const digitCount = (text: string): number => text.replace(/\D+/g, "").length;

/**
 * True when a digit run cannot be money.
 *
 * Two signals, either sufficient, and deliberately not a magnitude ceiling: a
 * real quote can run to five and six figures, and a threshold chosen to exclude
 * £563,889 would one day exclude a real extension.
 *
 *  - NINE OR MORE DIGITS. A spoken price is not nine digits long; a UK phone
 *    number is ten or eleven.
 *  - A LEADING ZERO on five digits or more. No price starts with a zero, and
 *    every UK number does.
 */
const cannotBeMoney = (run: string): boolean => {
  const digits = run.replace(/\D+/g, "");
  if (digits.length >= 9) return true;
  if (digits.length >= 5 && digits.startsWith("0")) return true;
  return false;
};

/**
 * Blanks anything in a sentence that is a contact detail rather than a price,
 * leaving the rest of the sentence — and any genuine price in it — intact.
 *
 * Returns the sentence unchanged when there is nothing to redact, so the
 * overwhelmingly common case costs one regex test.
 */
export const redactContactDetails = (sentence: string): string => {
  let out = sentence.replace(EMAIL, " ").replace(POSTCODE, " ");

  const hasCue = CONTACT_CUES.test(out);

  out = out.replace(DIGIT_RUN, (run) => {
    if (cannotBeMoney(run)) return " ";
    // Shorter runs are only redacted when the sentence announced a contact
    // detail AND the run is too long to be a plausible spoken amount. "The
    // code is 1234" goes; "the skim is 450" stays, and so does "£450".
    if (hasCue && digitCount(run) >= 4 && !/£/.test(sentence)) return " ";
    return run;
  });

  return out;
};

/**
 * Whether a sentence carries a contact detail at all — exported for callers
 * that want to log or flag rather than redact.
 */
export const mentionsContactDetail = (sentence: string): boolean =>
  EMAIL.test(sentence) ||
  POSTCODE.test(sentence) ||
  (CONTACT_CUES.test(sentence) &&
    (sentence.match(DIGIT_RUN) ?? []).some((run) => cannotBeMoney(run) || digitCount(run) >= 4));
