// Bounds an outbound/async operation so a hung dependency (Resend, Twilio,
// TrueLayer, the PDF renderer, the OpenAI token mint) can never wedge a request
// forever. Every external call in a user-blocking path must go through here:
// an unbounded await is how "Sending…" hangs and "couldn't start" 500s happen.
//
// The underlying promise isn't cancelled on timeout (most of these aren't
// abortable) — we simply stop awaiting it and reject, so the caller can resolve
// with a legible error instead of hanging. Where the call IS fetch-based, also
// pass AbortSignal.timeout(ms) at the call site so the socket is torn down too.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// Central budget for each outbound dependency, tuned so the whole send path
// resolves well inside the client's 15s "always resolve" guarantee.
export const TIMEOUT_MS = {
  pdf: 15_000,
  email: 10_000,
  sms: 10_000,
  openaiToken: 10_000,
  truelayer: 12_000,
  // Product analytics is best-effort and must never wedge the flow that emitted
  // an event. A hung events insert (or auth.getUser) would otherwise hang a
  // server action AFTER its real work is done — e.g. sendQuote flips the quote
  // to "sent" then awaits track(), leaving the client stuck on "Sending…".
  analytics: 5_000,
} as const;

export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
