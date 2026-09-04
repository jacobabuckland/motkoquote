import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// OBS-5. The wrapper's job here is source maps: without it a production stack
// trace resolves to minified bundle offsets, which fails the criterion that
// traces name real files and lines.
//
// Uploading needs SENTRY_AUTH_TOKEN in the build environment. It is absent
// locally and in any fork, and the plugin degrades to "build normally, upload
// nothing" rather than failing — which is what keeps `npm run build` working
// for a contributor who has no Sentry access.
export default withSentryConfig(nextConfig, {
  org: "motkoai",
  project: "javascript-nextjs",

  // The build log otherwise carries a block of Sentry output on every deploy.
  silent: process.env.CI !== "true",

  // Strip the uploaded maps from the client bundle afterwards. They are needed
  // by Sentry to symbolicate and by nobody else; leaving them served publishes
  // readable source for the whole app.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // No `tunnelRoute` here on purpose. The plugin would generate one, and a
  // generated route has no file under src/app/api/ — so the public-route
  // inventory in tests/acceptance/99.test.ts could never see it. The tunnel is
  // written by hand at src/app/api/monitoring/route.ts instead, which puts it
  // in that inventory and lets it state exactly what it forwards.

  // The SDK's logger statements, stripped from the production bundle.
  disableLogger: true,
});
