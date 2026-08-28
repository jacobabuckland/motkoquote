/**
 * Client-side instrumentation, run before the app becomes interactive.
 *
 * Next.js 16 replaces the old `sentry.client.config.ts` with this file
 * convention; the SDK reads it from here.
 */
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, errorReportingEnabled } from "@/lib/error-reporting/options";

if (errorReportingEnabled()) {
  Sentry.init(baseSentryOptions());
}

// Lets Sentry tie a client error to the navigation that led to it.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
