"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ErrorState } from "@/components/ui/error-state";
import { reportRenderError } from "@/app/actions";

// Route error boundary for the CONTRACTOR-facing app. Any server-component
// fetch that throws (a failed Supabase query, a dropped connection) lands here
// instead of a blank white screen. The user only ever sees plain English + a
// retry — never the raw error, which is logged for our own error handling.
//
// No longer app-WIDE: /q, /c and /i have their own boundaries now, because this
// copy is written for a signed-in contractor and was being shown to customers.
// One boundary for everything is also what made the 8 Sep triage expensive —
// five distinct-looking defects turned out to be one bug, and every one of them
// rendered this identical screen, so nothing on the page distinguished them.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[route error]", error);
    void reportRenderError({
      route: pathname,
      message: error.message,
      digest: error.digest,
    });
  }, [error, pathname]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-page-safe">
      <div className="w-full max-w-sm">
        <ErrorState
          title="That didn't load"
          description="Something went wrong loading this screen. Check your connection and try again."
          onRetry={reset}
          action={
            // Next's own hash of the error, which is in the server log against
            // the same failure. Reporting "it didn't load" was previously
            // unjoinable to anything; this is the one string that makes a
            // screenshot searchable.
            error.digest ? (
              <p className="mt-1.5 text-xs text-ink-muted">
                If it keeps happening, quote <span className="font-mono">{error.digest}</span>.
              </p>
            ) : undefined
          }
        />
      </div>
    </main>
  );
}
