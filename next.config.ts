import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * Error reporting build integration.
 *
 * Three things are deliberate here:
 *
 * 1. `tunnelRoute` is NOT set. It would make the SDK generate an API route to
 *    proxy events past ad blockers — and a generated route is invisible to
 *    `tests/acceptance/99.test.ts`, which walks `src/app/api/` and requires
 *    every route to be declared public or protected. A route that stops being
 *    seen is worse than one that fails the check (AGENTS.md), so we accept
 *    that some client events are blocked rather than add an unregistered
 *    endpoint. Server-side reporting — the part that matters — is unaffected.
 *
 * 2. Source-map upload is gated on SENTRY_AUTH_TOKEN. The CI gate runs
 *    `npm run build` with no Sentry configuration at all, so the plugin has to
 *    no-op cleanly there rather than failing the gate on a missing credential.
 *
 * 3. `telemetry: false` — no build-time phone-home from this repo.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Quiet unless something actually goes wrong, so the build log stays readable.
  silent: true,
  telemetry: false,
  // NOTE: `disableLogger` is not set. It is deprecated in favour of
  // `webpack.treeshake.removeDebugLogging`, and BOTH are inert here — this
  // project builds with Turbopack (the Next.js 16 default), which those
  // webpack-only options do not reach. Setting either only prints a
  // deprecation warning on every build, and a build log with a standing
  // warning in it is one where a real warning goes unread.
  sourcemaps: {
    // Without a token there is nothing to upload to; attempting it is what
    // turns a missing optional credential into a failed build.
    disable: !process.env.SENTRY_AUTH_TOKEN,
    // Never ship source maps to the browser — they would let anyone read the
    // server-action and query logic. Uploaded to Sentry, then deleted.
    deleteSourcemapsAfterUpload: true,
  },
});
