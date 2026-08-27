// Why the live voice call was refused, and what to tell the contractor.
//
// All four voice surfaces POST the SDP offer to /v1/realtime/calls and threw
// the same fixed string on any non-OK response:
//
//     throw new Error("Couldn't connect the live call — try again.");
//
// Three separate problems with that, in ascending order.
//
// "Try again" is wrong advice for half the failures. A 429 has two causes: a
// rate limit, which is transient and where retrying works; and
// `insufficient_quota`, where the account is out of credit and retrying can
// NEVER work. The status alone does not separate them — only the body does.
//
// It is not the contractor's account, it is ours. OPENAI_API_KEY is one key for
// the whole product, so quota exhaustion kills voice for every contractor at
// once while telling each of them, individually, to try again — implying the
// fault is their connection or their phone.
//
// And nobody found out. The catch block set local error state and nothing else:
// no log, no event. A total voice outage produced zero server-side evidence,
// so the first indication was a contractor getting in touch — with voice being
// the product's front door. That happened on 26 Aug and was caught in seconds
// only because someone was reading a browser console.
//
// Pure and deterministic so all four surfaces classify identically without a
// network.

export type RealtimeConnectFailure = {
  status: number;
  /** Whether trying again could plausibly succeed. */
  retryable: boolean;
  /** The provider's own error code, when it gave one. For logs, never for UI. */
  code: string | null;
  /** What the contractor is told. Never blames their device or connection. */
  message: string;
};

const RETRY_MESSAGE = "Couldn't connect the live call — try again.";

// Deliberately not "your account": the key is motko's, and a contractor reading
// this has done nothing wrong and can do nothing about it.
const UNAVAILABLE_MESSAGE =
  "Voice isn't available right now — this is on our side, not yours.";

/** The provider's `error.code`, if the body is JSON and carries one. */
const errorCode = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    const code = parsed.error?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
};

// Codes that mean "retrying cannot help", whatever the status says.
const TERMINAL_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "account_deactivated",
  "invalid_api_key",
]);

/**
 * Classifies a non-OK response from POST /v1/realtime/calls.
 *
 * Defaults to RETRYABLE whenever the body is unhelpful. Under-classifying
 * strands nobody — they retry, and it either works or they see the same screen
 * again. Over-classifying tells a contractor to give up on a blip.
 */
export const classifyRealtimeConnectFailure = (
  status: number,
  body: string,
): RealtimeConnectFailure => {
  const code = errorCode(body);

  // Auth and permission failures are configuration, not weather. No amount of
  // retrying fixes a revoked or wrong key.
  const terminalStatus = status === 401 || status === 403;
  const terminal = terminalStatus || (code !== null && TERMINAL_CODES.has(code));

  return {
    status,
    code,
    retryable: !terminal,
    message: terminal ? UNAVAILABLE_MESSAGE : RETRY_MESSAGE,
  };
};

/**
 * The payload for `logError`. Carries the status and the provider's code and
 * nothing else — never the Authorization header, the client secret, or the raw
 * body, any of which can carry material that should not reach an events table.
 */
export const realtimeConnectFailureContext = (
  failure: RealtimeConnectFailure,
  surface: string,
): { surface: string; status: number; code: string; retryable: boolean } => ({
  surface,
  status: failure.status,
  code: failure.code ?? "none",
  retryable: failure.retryable,
});
