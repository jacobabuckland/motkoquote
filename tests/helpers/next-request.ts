/**
 * Create a properly typed Request for route handler testing.
 *
 * new Request(...) passed to a route handler is TS2345 at every call site.
 * This factory wraps the construction to satisfy the type checker.
 *
 * @param options - Request configuration
 * @returns A properly typed Request object
 */
export function createNextRequest(options: {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Request {
  const { url, method = "GET", body, headers = {} } = options;

  const init: RequestInit = {
    method,
    headers: new Headers(headers),
  };

  // Only add body for methods that support it
  if (body && method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(body);
    // Ensure Content-Type is set for JSON bodies
    if (!headers["Content-Type"]) {
      (init.headers as Headers).set("Content-Type", "application/json");
    }
  }

  return new Request(url, init);
}
