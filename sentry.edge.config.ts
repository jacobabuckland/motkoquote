/**
 * Sentry initialisation for the edge runtime, which is where `src/proxy.ts`
 * runs — the auth check in front of every non-public route. An error here
 * logs a user out or hides the app entirely, so it is worth reporting even
 * though the runtime is a restricted one.
 *
 * (Next.js 16 renamed `middleware.ts` to `proxy.ts`; this is still the edge
 * runtime the Sentry docs call the middleware runtime.)
 */
import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions, errorReportingEnabled } from "@/lib/error-reporting/options";

if (errorReportingEnabled()) {
  Sentry.init(baseSentryOptions());
}
