import { NextRequest } from "next/server";

/**
 * Create a properly typed NextRequest for route handler testing.
 *
 * new Request(...) passed to a route handler is TS2345 at every call site.
 * This factory wraps the construction to satisfy the type checker.
 *
 * It returns a real `NextRequest`, not a plain `Request`. It used to return the
 * latter despite its name, which typechecks against a handler declared
 * `(request: Request)` and then throws the moment one declared
 * `(request: NextRequest)` reads `request.nextUrl` — undefined at runtime,
 * invisible to `tsc`. `api/companies-house/search` is such a handler.
 *
 * `NextRequest extends Request`, so every existing caller keeps working and
 * anything that only needs `Request` still accepts the result.
 *
 * @param options - Request configuration
 * @returns A properly typed NextRequest object
 */
export function createNextRequest(options: {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): NextRequest {
  const { url, method = "GET", body, headers = {} } = options;

  const requestHeaders = new Headers(headers);
  // Only add body for methods that support it
  const sendsBody = Boolean(body) && method !== "GET" && method !== "HEAD";

  if (sendsBody && !headers["Content-Type"]) {
    // Ensure Content-Type is set for JSON bodies
    requestHeaders.set("Content-Type", "application/json");
  }

  // Built in one literal rather than mutated through a `RequestInit`-annotated
  // variable: NextRequest's own init type is NARROWER than the DOM one (its
  // `signal` may not be null), so the annotation is a TS2345 at this call.
  return new NextRequest(url, {
    method,
    headers: requestHeaders,
    ...(sendsBody ? { body: JSON.stringify(body) } : {}),
  });
}
