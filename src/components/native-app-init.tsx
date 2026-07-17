"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/platform";
import { initNativePush } from "@/lib/push/native";

// Mounted once in the root layout. Inside the Capacitor iOS shell it hides the
// launch splash and wires notification taps to in-app navigation. On the web it
// renders nothing and every effect short-circuits via isNativeApp(). It does
// NOT prompt for notification permission — that happens contextually from the
// Settings "Enable notifications" button.
export const NativeAppInit = (): null => {
  useEffect(() => {
    if (!isNativeApp()) return;

    // Opt the WKWebView into native-only chrome behaviour (no text selection /
    // iOS callout on non-editable UI). Scoped here so the web app is unaffected.
    document.documentElement.classList.add("native-app");

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

  return null;
};
