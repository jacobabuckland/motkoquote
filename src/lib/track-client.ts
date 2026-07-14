"use client";

/**
 * Client-side event tracking. Posts to /api/track, which validates the event
 * name against the server-side allowlist and inserts via the service role.
 *
 * Fire-and-forget: never throws into the calling component.
 */

const SESSION_KEY = "motko_session_id";

const getSessionId = (): string | null => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
};

export const trackEvent = async (
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> => {
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        properties,
        path: window.location.pathname,
        session_id: getSessionId(),
      }),
      keepalive: true,
    });
  } catch {
    // Instrumentation must never break the product.
  }
};
