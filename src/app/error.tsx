"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

// App-wide route error boundary. Any server-component fetch that throws (a
// failed Supabase query, a dropped connection) lands here instead of a blank
// white screen. The user only ever sees plain English + a retry — never the
// raw error, which is logged for our own error handling.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <ErrorState
          title="That didn't load"
          description="Something went wrong loading this screen. Check your connection and try again."
          onRetry={reset}
        />
      </div>
    </main>
  );
}
