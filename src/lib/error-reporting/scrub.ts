/**
 * PII redaction for outbound error reports.
 *
 * This app carries real customer PII in places an error message can easily
 * quote back: `jobs.transcript`, `conversation_json` and `sow_json` hold the
 * customer's name, site address, phone and email as captured during intake,
 * and `contracts.signer_name` holds a signature. A Supabase error quotes the
 * offending row; a Zod error quotes the offending value; a thrown `Error`
 * quotes whatever the author interpolated. Any of those can reach Sentry.
 *
 * So nothing leaves this process unscrubbed. `scrubEvent` walks the whole
 * event rather than enumerating the fields we expect PII in — an allowlist of
 * fields is a list of the places we thought of, and the one we did not think
 * of is the one that leaks.
 *
 * The posture is fail-CLOSED, matching the rest of this codebase: if scrubbing
 * throws, the event is DROPPED rather than sent unscrubbed. Losing a stack
 * trace is recoverable; publishing a customer's address to a third party is
 * not.
 */

// Longest string we will send. Transcripts run to thousands of words, and a
// truncated one is still enough to identify the error while being far less of
// a disclosure. Applied after redaction so the redacted forms are preserved.
const MAX_STRING_LENGTH = 2000;

// How deep to walk before giving up. Sentry events are shallow; anything
// deeper is a cycle or a serialised payload we should not be sending anyway.
const MAX_DEPTH = 12;

/**
 * Keys whose values are structural rather than content — file paths, function
 * names, event ids. Redacting these would corrupt grouping and stack traces
 * without protecting anything: none of them can contain customer data.
 */
const STRUCTURAL_KEYS = new Set([
  "abs_path",
  "environment",
  "event_id",
  "filename",
  "function",
  "lineno",
  "colno",
  "module",
  "platform",
  "release",
  "timestamp",
  "type",
]);

/**
 * Keys we remove outright, wherever they appear. These carry credentials or
 * direct identifiers and have no diagnostic value that the rest of the event
 * does not already provide.
 */
const DROPPED_KEYS = new Set([
  "authorization",
  "cookie",
  "cookies",
  "ip_address",
  "set-cookie",
  "x-api-key",
]);

/**
 * Ordered redactions. Each is deliberately shaped to what it matches rather
 * than being maximally greedy — an over-matching redaction destroys the error
 * message it was meant to make safe, and a message redacted to nothing is a
 * report nobody can act on.
 */
const REDACTIONS: { pattern: RegExp; replacement: string }[] = [
  // JWTs — Supabase access tokens and service-role keys are all `eyJ…`.
  { pattern: /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, replacement: "[jwt]" },
  // Bearer tokens of any shape.
  { pattern: /\bBearer\s+[\w\-._~+/]{8,}={0,2}/gi, replacement: "Bearer [redacted]" },
  // Stripe and Anthropic secrets, should one ever be interpolated into a message.
  { pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, replacement: "[stripe_key]" },
  { pattern: /\bsk-ant-[A-Za-z0-9-]{8,}/g, replacement: "[anthropic_key]" },
  // Email addresses.
  { pattern: /[\w.+-]+@[\w-]+\.[\w.-]*[\w]/g, replacement: "[email]" },
  // UK phone numbers, international then national form.
  //
  // Matched as "a full UK-length run of digits with optional separators"
  // rather than as fixed groups, because the grouping varies by number type —
  // 07700 900123 is 5+6, 0161 496 0000 is 4+3+4, 020 7946 0958 is 3+4+4 — and
  // a fixed-group pattern silently misses whichever forms it was not written
  // against. The length requirement (10 or 11 digits total) is what keeps an
  // ordinary integer in an error message from matching, and the trailing \b
  // stops it firing inside a longer digit run.
  {
    pattern: /\+44\s?\(?0?\)?(?:[\s.-]?\d){9,10}\b/g,
    replacement: "[phone]",
  },
  { pattern: /\b0(?:[\s.-]?\d){9,10}\b/g, replacement: "[phone]" },
  // UK postcodes. Split into two patterns rather than making the space
  // optional in one, because the space is what makes the shape distinctive:
  // `[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}` with no separator also describes plenty
  // of ordinary alphanumeric ids ("a1b2cd" matches it exactly). So the spaced
  // form is matched case-insensitively, and the unspaced form only in upper
  // case, where a false positive is far less likely.
  //
  // This still over-matches an all-caps id of that exact shape, and that is
  // the deliberate direction to err in: a redacted id costs a slightly less
  // readable error message, while a missed postcode puts a customer's address
  // in a third-party system.
  {
    pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/gi,
    replacement: "[postcode]",
  },
  {
    pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}\b/g,
    replacement: "[postcode]",
  },
];

/**
 * Redact PII from a single string. Exported so the same rules can be applied
 * to a log line as to an outbound event — one set of rules, one place to fix
 * them.
 */
export const redactPii = (input: string): string => {
  let output = input;
  for (const { pattern, replacement } of REDACTIONS) {
    // Each pattern carries /g, so lastIndex must not leak between calls.
    pattern.lastIndex = 0;
    output = output.replace(pattern, replacement);
  }

  if (output.length > MAX_STRING_LENGTH) {
    return `${output.slice(0, MAX_STRING_LENGTH)}… [truncated ${output.length - MAX_STRING_LENGTH} chars]`;
  }
  return output;
};

const scrubValue = (value: unknown, depth: number): unknown => {
  if (depth > MAX_DEPTH) return "[max depth]";

  if (typeof value === "string") return redactPii(value);

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const lowered = key.toLowerCase();
      if (DROPPED_KEYS.has(lowered)) continue;
      if (STRUCTURAL_KEYS.has(lowered)) {
        result[key] = source[key];
        continue;
      }
      result[key] = scrubValue(source[key], depth + 1);
    }
    return result;
  }

  // Numbers, booleans, null, undefined — nothing to redact.
  return value;
};

/**
 * Scrub a whole Sentry event. Returns `null` if scrubbing fails, which tells
 * Sentry to drop the event: an unscrubbed event must never be the fallback.
 *
 * Typed against the shape we rely on rather than importing Sentry's `Event`,
 * so the scrubber stays unit-testable without booting the SDK.
 */
export const scrubEvent = <T extends object>(event: T): T | null => {
  try {
    return scrubValue(event, 0) as T;
  } catch {
    return null;
  }
};
