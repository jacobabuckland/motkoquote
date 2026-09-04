import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

// Server and edge runtime initialisation (OBS-5).
//
// Next 16 calls `register` once per server instance before it serves requests,
// and `onRequestError` whenever the server captures an error. Both are the
// documented file convention in
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
// rather than the sentry.server.config.ts layout older guides describe.

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  // No DSN means Sentry is simply off — local development, and any preview a
  // contributor runs without the variable. Initialising with an empty DSN
  // makes every call a silent no-op that still costs work on the error path.
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    // Ties a crash back to the deploy that produced it, which is what makes a
    // stack trace resolve against the right source maps.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // OBS-5's criterion is crash-free SESSIONS, not latency. Tracing is off:
    // it multiplies event volume and every span is another payload that could
    // carry customer data past the scrubber.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}

export const onRequestError = Sentry.captureRequestError;
