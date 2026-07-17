"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveQuote } from "./actions";

// Dashboard-inline archive control. Confirms before hiding the quote so a
// mis-tap on a phone can't silently drop a job out of the pipeline.
export const ArchiveQuoteButton = ({ quoteId }: { quoteId: string }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm("Archive this quote? It'll be removed from your dashboard.")) {
          return;
        }
        setError(false);
        startTransition(async () => {
          try {
            await archiveQuote({ quoteId });
            router.refresh();
          } catch {
            setError(true);
          }
        });
      }}
      className="inline-flex min-h-11 items-center text-sm font-medium text-secondary-text underline underline-offset-4 hover:text-primary disabled:opacity-50"
    >
      {isPending ? "Archiving…" : error ? "Try again" : "Archive"}
    </button>
  );
};
