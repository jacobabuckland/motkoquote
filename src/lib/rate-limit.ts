// Coarse per-caller rate limiting for unauthenticated endpoints, with a
// fail-CLOSED posture: if the limiter cannot answer, the caller is denied.
//
// The endpoint this exists for is the guest Realtime token mint, which spends
// OpenAI credit on every call and requires no account. Unbounded spend by
// anyone who finds the endpoint is the worse failure; a guest blocked by a
// limiter fault is recoverable (they retry).
//
// NOTE: this is deliberately a process-local fixed window, not a distributed
// counter. On a multi-instance serverless deployment the effective ceiling is
// per-instance, so the real limit is (limit × instances). That is what "coarse"
// buys — no new infrastructure, no new dependency, and a hard cap on what a
// single caller can extract from any one instance. If a shared counter is ever
// wanted, replace `consume` and leave every call site alone.

export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: "over_limit"; retryAfterSeconds: number }
  | { allowed: false; reason: "unavailable" };

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

type Bucket = { count: number; resetAt: number };

// Bounds the memory a flood of distinct keys can occupy. Reaching it is itself
// treated as "the limiter cannot answer" rather than silently allowing —
// see the fail-closed posture above.
const MAX_TRACKED_KEYS = 10_000;

const buckets = new Map<string, Bucket>();

const sweepExpired = (now: number): void => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
};

/**
 * Reports whether `key` may proceed, WITHOUT spending its allowance.
 *
 * Checking and recording are separate on purpose. What is scarce here is the
 * granted resource — a minted Realtime token spends credit — not the request
 * for one. A refusal upstream costs nothing, so it must not cost the caller
 * their allowance either: five transient OpenAI outages should not lock a guest
 * (or an App Store reviewer) out for an hour. Pair every allowed check with
 * `recordRateLimitUse` once the expensive thing has actually happened.
 *
 * Never throws: an internal fault surfaces as `{ allowed: false, reason:
 * "unavailable" }` so a caller cannot accidentally fail open by forgetting a
 * try/catch.
 */
export const checkRateLimit = (
  key: string,
  { limit, windowMs }: RateLimitOptions,
): RateLimitDecision => {
  try {
    if (!key) return { allowed: false, reason: "unavailable" };

    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      // No live bucket. Confirm we would be ABLE to track this caller before
      // allowing them through — a limiter that cannot record the use cannot
      // bound it, and unbounded is the failure we refuse.
      if (buckets.size >= MAX_TRACKED_KEYS) {
        sweepExpired(now);
        if (buckets.size >= MAX_TRACKED_KEYS) {
          return { allowed: false, reason: "unavailable" };
        }
      }
      return { allowed: true, remaining: limit };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        reason: "over_limit",
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    return { allowed: true, remaining: limit - existing.count };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
};

/**
 * Spends one unit of `key`'s allowance. Call this only after the granted,
 * expensive thing succeeded.
 *
 * Two callers can both pass `checkRateLimit` before either records, so a burst
 * can briefly exceed the limit by the number of in-flight requests. That is
 * bounded by concurrency, not by an attacker's patience, and is the accepted
 * cost of not charging callers for failures. Never throws.
 */
export const recordRateLimitUse = (
  key: string,
  { windowMs }: RateLimitOptions,
): void => {
  try {
    if (!key) return;

    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      if (buckets.size >= MAX_TRACKED_KEYS) {
        sweepExpired(now);
        if (buckets.size >= MAX_TRACKED_KEYS) return;
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    existing.count += 1;
  } catch {
    // Recording is best-effort; a fault here must not fail the request whose
    // expensive work already succeeded. The check is the gate, not this.
  }
};

/**
 * The caller identity used as the limit key.
 *
 * `x-forwarded-for` is a client-appendable list — the proxy appends the real
 * peer to whatever the client sent — so its FIRST entry is attacker-controlled
 * and useless as an identity. We prefer `x-real-ip` (set by the platform edge,
 * not forwardable) and otherwise take the LAST `x-forwarded-for` entry, which
 * is the hop our own edge appended.
 *
 * When no identity header is present at all, every such request shares one
 * bucket. That is the strict reading, not a bypass: unidentified callers
 * compete for a single allowance rather than each getting their own.
 */
export const clientIpKey = (headers: Headers): string => {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    const last = hops.at(-1);
    if (last) return last;
  }

  return "unidentified";
};

// Test seam: clears process-local state between cases.
export const __resetRateLimitState = (): void => {
  buckets.clear();
};
