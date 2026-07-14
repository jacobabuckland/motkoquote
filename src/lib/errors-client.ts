"use client";

/**
 * Client-side error logging. Posts to /api/log-error, which writes to
 * client_errors via the service role. Fire-and-forget: never throws.
 *
 * Dedupes identical consecutive errors (same message + path) within 30s so a
 * render loop or repeated rejection cannot flood the endpoint.
 */

const DEDUPE_WINDOW_MS = 30_000;
let lastKey: string | null = null;
let lastAt = 0;

const messageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name || "Unknown error";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unserialisable error";
  }
};

const stackOf = (error: unknown): string | null =>
  error instanceof Error && error.stack ? error.stack : null;

export const logClientError = (
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void => {
  try {
    const message = messageOf(error);
    const path = window.location.pathname;
    const key = `${message}::${path}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) return;
    lastKey = key;
    lastAt = now;

    void fetch("/api/log-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        message,
        stack: stackOf(error),
        path,
        context,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Error logging must never break the product.
  }
};
