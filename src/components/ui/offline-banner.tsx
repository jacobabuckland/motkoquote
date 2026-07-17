"use client";

import { useEffect, useState } from "react";

// App-wide connectivity banner. Non-blocking: it never covers content or traps
// the user — it just makes the offline state legible so a failed request reads
// as "no signal" rather than "the app is broken". Any in-progress recording or
// draft keeps its own state; this only surfaces connectivity, it doesn't reload
// or discard anything.
export const OfflineBanner = () => {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-warning-bg px-4 py-2 text-center text-sm font-medium text-warning"
      style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
    >
      No signal — we&apos;ll be ready when you are.
    </div>
  );
};
