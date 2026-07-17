"use client";

import { useEffect } from "react";

// Catches errors thrown in the root layout itself (where the normal error.tsx
// boundary can't reach). Must render its own <html>/<body>. Kept intentionally
// dependency-free so it can't fail to render for the same reason the app did.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
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
