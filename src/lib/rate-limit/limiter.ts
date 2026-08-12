/**
 * Core rate limiting logic with injectable store.
 */

import type { RateLimitStore } from "./store";

export interface RateLimitCheckParams {
  clientKey: string;
  routeKey: string;
  limit: number;
  windowSeconds: number;
  store: RateLimitStore;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Check if a request should be rate-limited.
 * Returns { allowed: true } if under limit, or { allowed: false, retryAfterSeconds: N } if over.
 */
export async function checkRateLimit(
  params: RateLimitCheckParams
): Promise<RateLimitResult> {
  const { clientKey, routeKey, limit, windowSeconds, store } = params;

  const now = new Date();

  // Atomically increment and get the new count and window start
  const result = await store.checkAndIncrement(clientKey, routeKey, windowSeconds);

  if (result.count <= limit) {
    return { allowed: true };
  }

  // Over the limit — calculate retry-after
  // The window started when the first request in this window was made
  // We need to wait until windowSeconds have passed from that start
  const elapsedSeconds = (now.getTime() - result.windowStart.getTime()) / 1000;
  const retryAfterSeconds = Math.ceil(windowSeconds - elapsedSeconds);

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, retryAfterSeconds),
  };
}

/**
 * In-memory store implementation for testing.
 * Not suitable for production (no persistence, no cross-instance coordination).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private records = new Map<string, { count: number; windowStart: Date }>();

  async checkAndIncrement(
    clientKey: string,
    routeKey: string,
    windowSeconds: number
  ): Promise<{ count: number; windowStart: Date }> {
    const key = `${clientKey}:${routeKey}`;
    const now = new Date();

    const existing = this.records.get(key);

    // If no existing record or window has expired, start a new window
    if (
      !existing ||
      now.getTime() - existing.windowStart.getTime() >= windowSeconds * 1000
    ) {
      const newRecord = { count: 1, windowStart: now };
      this.records.set(key, newRecord);
      return newRecord;
    }

    // Increment within the current window
    existing.count += 1;
    return { count: existing.count, windowStart: existing.windowStart };
  }
}
