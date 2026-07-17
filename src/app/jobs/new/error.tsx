"use client";

import { useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Without a boundary here, a render-phase crash on the voice-intake page shows
// as a blank white screen (there's no root error.tsx). This surfaces the real
// error text on-device so a WKWebView-specific failure is diagnosable without
// attaching Safari Web Inspector.
export default function NewJobError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[jobs/new] render error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/" backLabel="Cancel" />
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-text-secondary">
            The voice screen hit an error before it could start.
          </p>
          <Card className="w-full break-words text-left text-xs text-error">
            {error.message || "Unknown error"}
            {error.digest ? `\n(digest: ${error.digest})` : ""}
          </Card>
          <Button type="button" onClick={reset}>
            Try again
          </Button>
        </div>
      </main>
    </div>
  );
}
