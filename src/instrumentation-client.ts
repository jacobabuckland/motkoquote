import * as Sentry from "@sentry/nextjs";
import { Capacitor } from "@capacitor/core";
import { scrubEvent } from "@/lib/sentry-scrub";

// Browser and iOS-shell initialisation (OBS-5).
//
// The Capacitor shell runs this same bundle inside a WKWebView, so this covers
// JavaScript crashes on the phone as well as in the browser. It does NOT cover
// a crash in the native Swift layer — that needs @sentry/capacitor and an
// Xcode build step. The `platform` tag below is what lets you tell shell
// crashes from browser ones when reading the dashboard, and what would make
// the absence of native crashes noticeable rather than reassuring.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    // The default integration records every console call as a breadcrumb.
    // OBS-2's client log wraps console.error, and those messages carry quote
    // content, so the payloads are dropped in the scrubber — but not recording
    // them at all is cheaper and leaves less to go wrong.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "Breadcrumbs"),
  });

  Sentry.setTag("platform", Capacitor.isNativePlatform() ? "ios-shell" : "web");
}

// Required by Next 16 for client-side navigation instrumentation.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
