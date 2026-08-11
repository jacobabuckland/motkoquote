/**
 * Parse rate limit configuration from environment variables.
 * Returns null if the env var is not set (meaning no limit configured).
 */
export function getRateLimitConfig(
  perXEnvVar: string,
  windowEnvVar: string,
): { maxRequests: number; windowSeconds: number } | null {
  const maxRequests = process.env[perXEnvVar];
  const windowSeconds = process.env[windowEnvVar];

  if (!maxRequests || !windowSeconds) {
    console.warn(`[rate-limit] ${perXEnvVar} or ${windowEnvVar} not set, no limit applied`);
    return null;
  }

  return {
    maxRequests: parseInt(maxRequests, 10),
    windowSeconds: parseInt(windowSeconds, 10),
  };
}
