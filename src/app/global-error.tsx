"use client";

import { useEffect } from "react";
import { reportBoundaryError } from "@/lib/error-reporting/client";

// Catches errors thrown in the root layout itself (where the normal error.tsx
// boundary can't reach). Must render its own <html>/<body>.
//
// The RENDER path is still intentionally dependency-free, so it can't fail for
// the same reason the app did — the markup below imports nothing. Reporting is
// confined to the effect, and reportBoundaryError swallows its own failures;
// the SDK it calls is already loaded on every page by instrumentation-client,
// so this adds no failure mode the app does not already carry.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError(error, "global error");
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-full bg-background text-foreground">
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-medium">That didn&apos;t load</p>
          <p className="text-sm text-text-secondary">
            Something went wrong. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
