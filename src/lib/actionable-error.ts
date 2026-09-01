// Getting an authored, contractor-facing message out of a Server Action.
//
// Next.js redacts the message of ANY error a Server Action rejects with once
// the build is a production one. React's Flight client replaces it wholesale
// with a fixed notice —
//
//   "An error occurred in the Server Components render. The specific message
//    is omitted in production builds to avoid leaking sensitive details. …"
//
// — and that is what the contractor was shown under "Send quote" on
// motko.app: not a failure the app had anything to say about, just React's
// internal notice, with no way forward.
//
// The redaction is right by default: a Supabase error string or a stack has no
// business reaching a customer's phone. What it also swallowed, though, were
// the messages that are the product — the "is this £0 deliberate?" question,
// the narrative-vs-total mismatch, the reconciliation gate's list of which
// lines don't add up. Those are asked BY throwing, and the quote editor
// recognises them by matching on `err.message`, so in production every one of
// those matches failed and the send became a dead end.
//
// One thing does survive redaction intact: `error.digest`. Next's
// `createReactServerErrorHandler` respects a digest already present on the
// thrown error rather than hashing a new one, and the Flight client copies it
// verbatim onto the error it hands the client (`streamState.digest =
// buffer.digest`). So an authored message travels there.
//
// The prefix is what keeps this deliberate. Only a message passed through
// `actionableError` is opted in; everything else still redacts, which is the
// behaviour we want for anything originating in the database or a third party.

const ACTIONABLE_PREFIX = "MOTKO_ACTIONABLE;";

// React's production stand-in, matched on the stable middle clause rather than
// the whole sentence so a wording change upstream doesn't silently turn the
// notice back into an "authored" message.
const REDACTED_NOTICE = "omitted in production builds";

/**
 * An error whose message is meant for the contractor, and will therefore still
 * be readable after a production build has redacted it.
 *
 * Throw this — rather than a bare `Error` — for anything a person is supposed
 * to read and act on. Never for a database error, an upstream API's message,
 * or anything else carrying detail we have not written ourselves: the digest
 * crosses to the client, so putting a raw error string on it defeats the
 * redaction on purpose.
 */
export const actionableError = (message: string): Error => {
  const error = new Error(message);
  (error as Error & { digest?: string }).digest = ACTIONABLE_PREFIX + message;
  return error;
};

/**
 * The authored message behind a rejected Server Action, or null when there
 * isn't one.
 *
 * Reads the digest first, because that is the only copy that survives a
 * production build. Falls back to `err.message`, which is the real message in
 * development and under vitest (nothing redacts there, and the server action is
 * called directly) — but never when the message IS React's redaction notice,
 * which is a description of a message rather than one.
 *
 * A null return means "we have nothing to say about this" and the caller should
 * show its own fallback copy, not the notice.
 */
export const actionableMessage = (err: unknown): string | null => {
  if (!(err instanceof Error)) return null;

  const { digest } = err as Error & { digest?: unknown };
  if (typeof digest === "string" && digest.startsWith(ACTIONABLE_PREFIX)) {
    return digest.slice(ACTIONABLE_PREFIX.length);
  }

  if (err.message.includes(REDACTED_NOTICE)) return null;
  return err.message;
};

/**
 * The digest Next generated for an error we did NOT author, for quoting in
 * support copy. It is the only handle on a redacted failure that ties the
 * contractor's screen to the server log, so it is worth showing.
 */
export const supportDigest = (err: unknown): string | null => {
  if (!(err instanceof Error)) return null;
  const { digest } = err as Error & { digest?: unknown };
  if (typeof digest !== "string" || digest.startsWith(ACTIONABLE_PREFIX)) {
    return null;
  }
  return digest;
};
