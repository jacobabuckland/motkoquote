"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativeApp } from "@/lib/platform";
import { initNativePush } from "@/lib/push/native";
import { hasGuestArtefact } from "@/lib/guest/session";
import { createClient } from "@/lib/supabase/client";
import { installClientLog } from "@/lib/client-log";

// Time threshold in milliseconds: only refresh if app was backgrounded for
// longer than this duration. Prevents disruptive refreshes when briefly
// app-switching to copy a phone number or check a notification.
const BACKGROUND_THRESHOLD_MS = 30_000; // 30 seconds

// Routes that should never refresh on resume, even if the session is valid and
// the threshold is met. These routes either have long-lived connections (WebRTC
// voice sessions) or unsaved form state that would be lost.
const REFRESH_EXEMPT_ROUTES = [
  "/setup/voice", // Voice session (WebRTC)
  "/jobs/new", // Job voice intake (WebRTC)
  "/start", // Guest voice intake (WebRTC) and guest quote preview
  "/i/", // Invoice payment (mid-payment flow)
  "/jobs/", // Job detail (unsaved line items) - but NOT /jobs/new
  "/setup", // Business setup form
  "/login", // Login page
  "/signup", // Signup page
  "/auth/", // Auth routes
];

// Public customer-facing routes that do not require authentication. Even if the
// session is expired, the app stays on these routes instead of redirecting to
// /login.
const PUBLIC_ROUTES = [
  "/q/", // Quote view
  "/i/", // Invoice payment
  "/c/", // Contract view
  "/start", // Guest quote flow — capture and PDF preview, no account
];

// Mounted once in the root layout. Inside the Capacitor iOS shell it hides the
// launch splash and wires notification taps to in-app navigation. On the web it
// renders nothing and every effect short-circuits via isNativeApp(). It does
// NOT prompt for notification permission — that happens contextually from the
// Settings "Enable notifications" button.
export const NativeAppInit = (): null => {
  const router = useRouter();
  const pathname = usePathname();

  // Deliberately NOT guarded by isNativeApp(): the console is unreachable in
  // the WKWebView and equally unreachable on a tester's phone browser, and this
  // is the one client component the root layout mounts on every route, so it is
  // where an app-wide buffer has to start. Idempotent, so a remount is free.
  useEffect(() => {
    installClientLog();
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;

    // Opt the WKWebView into native-only chrome behaviour (no text selection /
    // iOS callout on non-editable UI). Scoped here so the web app is unaffected.
    document.documentElement.classList.add("native-app");

    // Initialize status bar style for contrast against brand green (#004225).
    // Style.Light provides white text (time, battery, signal) that remains
    // legible on the dark green background regardless of OS appearance mode.
    //
    // The .catch() is load-bearing, not defensive habit. `@capacitor/status-bar`
    // is a dependency in package.json but CapacitorStatusBar is NOT in
    // ios/App/Podfile — the native side was never synced — so on the real device
    // this rejects with:
    //
    //     Error: "StatusBar" plugin is not implemented on ios
    //
    // Unhandled, that is an uncaught promise rejection on EVERY dashboard load
    // in the shell (23 of them in Sentry over 26 hours, JAVASCRIPT-NEXTJS-1).
    // It was the only native call in this effect without one; initNativePush
    // and the splash-screen import below both already swallow their failures.
    //
    // Styling the status bar is cosmetic, so failing quietly is right: the
    // backdrop in status-bar-backdrop.tsx already keeps the strip opaque. A
    // `npx cap sync` that installs the pod makes this succeed instead, and the
    // catch then costs nothing.
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Light }).catch(() => {
        // Plugin not installed on the native side, or the call failed. Cosmetic.
      });
    }

    void initNativePush((url) => {
      // Tapped a notification: navigate the WKWebView to the payload's
      // deep-link (a full https://motko.app/... URL from apns.ts).
      window.location.assign(url);
    });

    void import("@capacitor/splash-screen")
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {
        // Splash auto-dismisses after launchShowDuration; ignore.
      });
  }, []);

  // App lifecycle listener: revalidate session and refresh route on resume
  useEffect(() => {
    if (!isNativeApp()) return;

    let lastBackgroundedAt: number | null = null;

    const handleAppStateChange = async (state: { isActive: boolean }) => {
      if (!state.isActive) {
        // App went to background or inactive: record the timestamp
        lastBackgroundedAt = Date.now();
        return;
      }

      // App became active. Check if we should refresh.
      if (lastBackgroundedAt === null) {
        // First activation or no background event yet: do nothing
        return;
      }

      const backgroundDuration = Date.now() - lastBackgroundedAt;
      if (backgroundDuration < BACKGROUND_THRESHOLD_MS) {
        // Backgrounded for less than threshold: skip refresh
        return;
      }

      // Threshold met: revalidate the session
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          // Network error or Supabase client error: do not redirect, let the
          // offline banner surface connectivity issues
          console.error("Session revalidation failed:", error);
          return;
        }

        const hasSession = data.session !== null;

        if (!hasSession) {
          // No session is the NORMAL state for a guest, not an expiry. Two
          // independent guards, deliberately both: the route check covers the
          // guest flow's own paths, and the artefact check covers a guest who
          // has work in progress wherever they happen to be — the route check
          // alone would break the moment the guest flow spans another path.
          const isPublicRoute = PUBLIC_ROUTES.some((prefix) =>
            pathname.startsWith(prefix)
          );

          if (!isPublicRoute && !hasGuestArtefact()) {
            // Not a public route: redirect to login with the current pathname
            // so the user can return after authenticating
            const redirectUrl = `/login?redirect=${encodeURIComponent(pathname)}`;
            router.push(redirectUrl);
          }

          // Public route, or a guest mid-quote: stay exactly where they are.
          return;
        }

        // Session is valid. Check if the current route is exempt from refresh.
        const isExemptRoute =
          REFRESH_EXEMPT_ROUTES.some((prefix) => {
            // Special handling for /jobs/: exempt all job detail routes
            // (/jobs/abc123) but NOT /jobs/new
            if (prefix === "/jobs/") {
              return pathname.startsWith("/jobs/") && pathname !== "/jobs/new";
            }
            return pathname.startsWith(prefix);
          }) || pathname === "/setup"; // Exact match for /setup

        if (!isExemptRoute) {
          // Not exempt: refresh the route to re-fetch server components
          router.refresh();
        }
      } catch (err) {
        // Unexpected error during session check: log and do nothing
        console.error("Error during app resume session check:", err);
      }
    };

    // Register the listener (addListener returns a Promise<PluginListenerHandle>)
    // Store the promise itself so we can await it in cleanup if needed
    const listenerPromise = App.addListener("appStateChange", handleAppStateChange);

    // Cleanup: remove the listener on unmount
    // Wait for the promise to resolve, then call remove() on the handle
    return () => {
      void listenerPromise.then((handle) => handle.remove());
    };
  }, [router, pathname]);

  // Universal link handler: navigate to the incoming URL when the app opens via
  // applinks (e.g., returning from TrueLayer after payment or mandate setup)
  useEffect(() => {
    if (!isNativeApp()) return;

    const handleAppUrlOpen = (event: { url: string }) => {
      // Guard against missing or malformed URLs
      if (!event.url) {
        console.error("appUrlOpen: missing URL in event");
        return;
      }

      try {
        // Parse the incoming URL to extract the path, query params, and fragment
        const url = new URL(event.url);
        const pathWithQuery = url.pathname + url.search + url.hash;

        // Navigate the WKWebView to the specific path, preserving query params
        window.location.assign(pathWithQuery);
      } catch (err) {
        // Malformed URL: log and fall through to root rather than crashing
        console.error("appUrlOpen: malformed URL", event.url, err);
        window.location.assign('/');
      }
    };

    const listenerPromise = App.addListener("appUrlOpen", handleAppUrlOpen);

    return () => {
      void listenerPromise.then((handle) => handle.remove());
    };
  }, []);

  return null;
};
