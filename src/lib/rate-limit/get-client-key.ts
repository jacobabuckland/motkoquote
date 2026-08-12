/**
 * Derive a client key for rate limiting from request headers and resource IDs.
 */

export function deriveClientKey(
  request: Request,
  resourceIds: Record<string, string>
): string | null {
  // Prefer resource ID (for routes that have one)
  const resourceId =
    resourceIds.invoiceId ||
    resourceIds.quoteId ||
    resourceIds.contractId;

  if (resourceId) {
    return `resource:${resourceId}`;
  }

  // Fall back to IP address
  // Check if headers exists and has the get method (defensive for tests)
  if (request.headers && typeof request.headers.get === "function") {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) {
      // x-forwarded-for may contain multiple IPs; take the first
      const ip = forwardedFor.split(",")[0].trim();
      return `ip:${ip}`;
    }

    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      return `ip:${realIp}`;
    }
  }

  // Cannot derive a client key
  return null;
}
