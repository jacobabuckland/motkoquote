import type { NextRequest } from "next/server";

/**
 * Extracts the client IP address from a Next.js request or headers.
 * Checks x-forwarded-for (leftmost IP in chain) and x-real-ip, falling back to request.ip.
 * Returns null if no IP can be determined — callers should fail open when IP is unavailable.
 */
export function getClientIp(request: NextRequest): string | null {
  // x-forwarded-for may contain a chain of proxies: "client, proxy1, proxy2"
  // The leftmost IP is the original client.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  // Next.js 15+ may expose request.ip
  if ("ip" in request && typeof request.ip === "string") {
    return request.ip;
  }

  return null;
}

/**
 * Extracts the client IP from Next.js headers() in server actions.
 * Server actions don't receive a NextRequest, so we read from the Headers object.
 */
export function getClientIpFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp;

  return null;
}
