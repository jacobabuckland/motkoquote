"use client";

import * as Sentry from "@sentry/nextjs";

/**
 * Report an error caught by a React error boundary.
 *
 * Every boundary in the app funnels through here so the policy — what gets
 * tagged, what gets logged, what happens when reporting itself fails — lives
 * in one place rather than being restated (and drifting) in each boundary.
 *
 * The console line is kept alongside the Sentry call on purpose: it is what
 * shows up in the browser during development, where no DSN is configured and
 * Sentry is inert.
 */
export const reportBoundaryError = (
  error: Error & { digest?: string },
  boundary: string,
): void => {
  console.error(`[${boundary}]`, error);

  try {
    Sentry.captureException(error, {
      tags: { boundary },
      // The digest is how a client-side boundary error is matched to the
      // server-side error that produced it — Next.js only exposes the message
      // to the browser in development, so in production this is the only
      // handle on what actually threw.
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  } catch {
    // Reporting must never be the reason an error screen fails to render.
  }
};
