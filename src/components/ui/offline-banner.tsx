"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { initFetchMonitor } from "@/lib/fetch-monitor";

// App-wide connectivity banner. Non-blocking: it never covers content or traps
// the user — it just makes the offline state legible so a failed request reads
// as "no signal" rather than "the app is broken". Any in-progress recording or
// draft keeps its own state; this only surfaces connectivity, it doesn't reload
// or discard anything.
//
// The banner appears when either:
// - navigator.onLine reports offline (fast path), OR
// - consecutive fetch failures indicate network issues (captive portal, etc.)
export const OfflineBanner = () => {
  const [navigatorOffline, setNavigatorOffline] = useState(false);
  const [fetchOffline, setFetchOffline] = useState(false);

  // Initialize fetch monitor synchronously before paint so tests don't race
  useLayoutEffect(() => {
    initFetchMonitor();
  }, []);

  useEffect(() => {
    // Track navigator.onLine state
    const syncNavigator = () => setNavigatorOffline(!navigator.onLine);
    syncNavigator();
    window.addEventListener("online", syncNavigator);
    window.addEventListener("offline", syncNavigator);

    // Track fetch monitor state (consecutive fetch failures)
    const handleFetchOffline = () => setFetchOffline(true);
    const handleFetchOnline = () => setFetchOffline(false);

    window.addEventListener("fetch-offline", handleFetchOffline);
    window.addEventListener("fetch-online", handleFetchOnline);

    return () => {
      window.removeEventListener("online", syncNavigator);
      window.removeEventListener("offline", syncNavigator);
      window.removeEventListener("fetch-offline", handleFetchOffline);
      window.removeEventListener("fetch-online", handleFetchOnline);
    };
  }, []);

  // Show banner if EITHER signal indicates offline
  const offline = navigatorOffline || fetchOffline;

  if (!offline) return null;

  return (
    <div
      role="status"
      // z-[60], above the toast layer's z-50. Both now sit at the top of the
      // viewport, and on equal z the toast would win on DOM order — hiding a
      // persistent "you are offline" behind a message that disappears in three
      // seconds. The banner outranks it: it explains why the action the toast
      // is reporting on may not have worked.
      className="sticky top-0 z-[60] bg-warning-bg px-4 py-2 text-center text-sm font-medium text-warning"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      No signal — we&apos;ll be ready when you are.
    </div>
  );
};
