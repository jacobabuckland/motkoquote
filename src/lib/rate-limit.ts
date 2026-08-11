import { createAdminClient } from "@/lib/supabase/admin";

type RateLimitConfig = {
  maxRequests: number;
  windowSeconds: number;
};

type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

type RateLimitCheck = {
  key: string;
  config: RateLimitConfig;
};

// In-memory cache to reduce DB load for recent limit checks
const cache = new Map<string, { allowed: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 5000; // 5 second cache

// In-memory fallback store when database is not available (e.g., tests)
const inMemoryStore = new Map<string, number[]>(); // key -> array of timestamps
let useInMemoryStore = false;

/**
 * Check multiple rate limits with logical AND: all limits must pass for the request to be allowed.
 * Returns the longest retryAfter if any limit is exceeded.
 */
export async function checkRateLimit(
  checks: RateLimitCheck[],
  options: { skipAuth?: boolean } = {},
): Promise<RateLimitResult> {
  if (options.skipAuth) {
    return { allowed: true };
  }

  try {
    let maxRetryAfter = 0;
    let anyExceeded = false;

    for (const check of checks) {
      const result = await checkSingleLimit(check.key, check.config);
      if (!result.allowed) {
        anyExceeded = true;
        maxRetryAfter = Math.max(maxRetryAfter, result.retryAfter);
      }
    }

    if (anyExceeded) {
      return { allowed: false, retryAfter: maxRetryAfter };
    }

    return { allowed: true };
  } catch (err) {
    // Fail open: if the rate limiter itself fails, allow the request
    console.error("[rate-limit] Backing store error, failing open:", err);
    return { allowed: true };
  }
}

/**
 * Check a single rate limit using either database or in-memory store.
 */
async function checkSingleLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  // Check cache first
  const cacheKey = `${key}:${config.maxRequests}:${config.windowSeconds}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed ? { allowed: true } : { allowed: false, retryAfter: Math.ceil((cached.expiresAt - Date.now()) / 1000) };
  }

  // Try database first, fall back to in-memory on failure
  if (!useInMemoryStore) {
    try {
      return await checkWithDatabase(key, config, cacheKey);
    } catch (err) {
      console.warn("[rate-limit] Database unavailable, falling back to in-memory store:", (err as Error).message);
      useInMemoryStore = true;
      // Fall through to in-memory check
    }
  }

  return checkWithInMemory(key, config, cacheKey);
}

/**
 * Check rate limit using database backing store.
 */
async function checkWithDatabase(
  key: string,
  config: RateLimitConfig,
  cacheKey: string,
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  // Clean up old entries for this key (older than the window)
  await admin
    .from("rate_limits")
    .delete()
    .eq("key", key)
    .lt("timestamp", windowStart);

  // Count recent requests within the window
  const { data: recentRequests, error: countError } = await admin
    .from("rate_limits")
    .select("id", { count: "exact", head: false })
    .eq("key", key)
    .gte("timestamp", windowStart);

  if (countError) {
    throw countError;
  }

  const count = recentRequests?.length ?? 0;

  if (count >= config.maxRequests) {
    // Find the oldest request in the current window to calculate retryAfter
    const { data: oldestInWindow } = await admin
      .from("rate_limits")
      .select("timestamp")
      .eq("key", key)
      .gte("timestamp", windowStart)
      .order("timestamp", { ascending: true })
      .limit(1)
      .maybeSingle();

    const oldestTimestamp = oldestInWindow?.timestamp ?? windowStart;
    const retryAfter = Math.ceil((oldestTimestamp + config.windowSeconds * 1000 - now) / 1000);

    // Cache the rejection
    cache.set(cacheKey, { allowed: false, expiresAt: now + retryAfter * 1000 });

    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  // Record this request
  const { error: insertError } = await admin
    .from("rate_limits")
    .insert({ key, timestamp: now });

  if (insertError) {
    throw insertError;
  }

  // Cache the success
  cache.set(cacheKey, { allowed: true, expiresAt: now + CACHE_TTL_MS });

  return { allowed: true };
}

/**
 * Check rate limit using in-memory backing store.
 */
function checkWithInMemory(
  key: string,
  config: RateLimitConfig,
  cacheKey: string,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  // Get or create timestamp array for this key
  let timestamps = inMemoryStore.get(key) || [];

  // Clean up old timestamps outside the window
  timestamps = timestamps.filter(ts => ts >= windowStart);

  if (timestamps.length >= config.maxRequests) {
    // Find the oldest timestamp to calculate retryAfter
    const oldestTimestamp = timestamps[0] ?? windowStart;
    const retryAfter = Math.ceil((oldestTimestamp + config.windowSeconds * 1000 - now) / 1000);

    // Cache the rejection
    cache.set(cacheKey, { allowed: false, expiresAt: now + retryAfter * 1000 });

    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }

  // Record this request
  timestamps.push(now);
  inMemoryStore.set(key, timestamps);

  // Cache the success
  cache.set(cacheKey, { allowed: true, expiresAt: now + CACHE_TTL_MS });

  return { allowed: true };
}

// Alias for backwards compatibility (plural form)
export const checkRateLimits = checkRateLimit;
