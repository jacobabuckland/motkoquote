// Checking a captured customer detail against what was actually said.
//
// The intake captures the customer's name, email, phone and site address from
// the call, and the editor marks three of them "From the call — check the
// spelling. Tap to confirm." That prompt shows the contractor a value with
// NOTHING to compare it against, so confirming it is a formality: you cannot
// spot a transposition you never heard.
//
// Job 30faef2a proved the cost. The transcript says the contact number is
// "07479 556410"; the field carried "07647 955641". Every other captured slot —
// first name, surname, email, street, postcode — appears in the transcript
// verbatim. Only the phone was unsupported by anything that was said, and the
// phone was the one field with no hint on it at all. With SMS defaulted on, the
// quote — customer name, site address, price — was one tap from a stranger.
//
// So the fix is to show the words behind the value, and to say plainly when
// there are none. "We cannot find this in the call" is the useful answer here,
// and it is the answer the failing case produces.
//
// Pure and deterministic: no transcript parsing lives in the component.

/** Digits only, so spacing and punctuation cannot hide a match. */
const digitsOf = (value: string): string => value.replace(/\D+/g, "");

/** Lowercased, with runs of non-alphanumerics collapsed to single spaces. */
const loose = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type SupportingSpan =
  /** The transcript contains this value; `span` is the sentence around it. */
  | { kind: "found"; span: string }
  /** Nothing in the transcript supports it — the case that matters. */
  | { kind: "unsupported" }
  /** No transcript stored, so there is nothing to check against either way. */
  | { kind: "unknown" };

/**
 * How to compare — a phone number is matched on its digits, everything else on
 * its words. A postcode spoken "S E one, nine F U" will not match as text, so
 * an address falls back to matching any substantial part of it.
 */
export type DetailKind = "phone" | "text";

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

/**
 * Finds the sentence of the transcript that supports a captured value, or
 * reports that none does.
 *
 * Deliberately generous about WHAT counts as support: the goal is to surface
 * the words for a human to read, not to adjudicate. A false "found" costs a
 * contractor one glance; a false "unsupported" would train them to ignore this
 * the way the old prompt did.
 */
export const findSupportingSpan = (
  transcript: string | null | undefined,
  value: string | null | undefined,
  kind: DetailKind = "text",
): SupportingSpan => {
  if (!transcript || transcript.trim().length === 0) return { kind: "unknown" };
  if (!value || value.trim().length === 0) return { kind: "unknown" };

  const sentences = transcript.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);

  if (kind === "phone") {
    const wanted = digitsOf(value);
    // A UK mobile is 11 digits; fewer than 6 is not a number worth matching on
    // and would hit any figure in the call.
    if (wanted.length < 6) return { kind: "unknown" };

    const hit = sentences.find((sentence) => digitsOf(sentence).includes(wanted));
    return hit ? { kind: "found", span: hit.trim() } : { kind: "unsupported" };
  }

  const wanted = loose(value);
  if (wanted.length === 0) return { kind: "unknown" };

  const whole = sentences.find((sentence) => loose(sentence).includes(wanted));
  if (whole) return { kind: "found", span: whole.trim() };

  // Multi-word values — a full name, an address — are rarely said as one
  // uninterrupted run, so a sentence carrying every substantial part counts.
  // "50 Holland Street, SE1 9FU" is support even when the postcode was spelled
  // out letter by letter and the street named a sentence earlier.
  const parts = wanted.split(" ").filter((part) => part.length >= 3);
  if (parts.length >= 2) {
    const partial = sentences.find((sentence) => {
      const haystack = loose(sentence);
      return parts.every((part) => haystack.includes(part));
    });
    if (partial) return { kind: "found", span: partial.trim() };

    // Or spread across the transcript rather than any single sentence.
    const haystack = loose(transcript);
    if (parts.every((part) => haystack.includes(part))) {
      return { kind: "found", span: sentences.find((s) => loose(s).includes(parts[0]!))?.trim() ?? "" };
    }
  }

  return { kind: "unsupported" };
};
