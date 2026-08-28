/**
 * Sentry initialisation for the Node.js server runtime — server components,
 * route handlers, server actions and cron routes.
 *
 * Loaded by `src/instrumentation.ts`. Named at the repository root because
 * that is where @sentry/nextjs' build plugin looks for it.
 */
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, errorReportingEnabled } from "@/lib/error-reporting/options";

if (errorReportingEnabled()) {
  Sentry.init(baseSentryOptions());
}
