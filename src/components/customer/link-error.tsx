"use client";

// What a CUSTOMER sees when their quote, contract or invoice link hits a
// server fault.
//
// Until this existed, one boundary — src/app/error.tsx — rendered "That didn't
// load. Something went wrong loading this screen. Check your connection and try
// again." for every uncaught error anywhere in the app. That copy is written
// for a signed-in contractor looking at their own dashboard, and it is wrong
// here in three ways:
//
//   - "Check your connection" blames the customer for our fault. On 8 Sep a
//     customer opening a quote link got this because a malformed APNS key made
//     the contractor's notification throw. Their connection was fine.
//   - It offers no way to tell a broken link from a broken server, so a
//     customer cannot know whether to retry or to ask for a new link.
//   - It gives them nothing to quote. The failure was invisible until someone
//     went looking in Sentry.
//
// It also made triage expensive in a way worth recording: five distinct-looking
// defects were reported from one bug, because every one of them rendered this
// identical screen. The digest below is what makes a customer's report joinable
// to a server log line.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reportRenderError } from "@/app/actions";

export const CustomerLinkError = ({
  error,
  reset,
  /** "quote", "contract", "invoice" — what the customer was trying to open. */
  document,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  document: string;
}) => {
  const pathname = usePathname();

  useEffect(() => {
    console.error("[customer link error]", error);
    void reportRenderError({
      route: pathname,
      message: error.message,
      digest: error.digest,
    });
  }, [error, pathname]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 pb-6 pt-page-safe">
      <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-card border border-line bg-card px-5 py-6">
        <h1 className="text-base font-semibold text-ink">
          We couldn&apos;t open this {document}
        </h1>
        {/* Says whose fault it is, because it is ours, and says what is safe —
            a customer who has just tried to accept a quote needs to know
            whether they accidentally did. */}
        <p className="text-sm text-ink-secondary">
          Something went wrong at our end, not yours. Nothing you&apos;ve done has been
          lost. Try again in a moment.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          Try again
        </Button>
        {/* The digest is Next's own hash of the error, and it is in the server
            log against the same failure. Without it a customer's "it didn't
            work" cannot be matched to anything. */}
        {error.digest && (
          <p className="text-xs text-ink-muted">
            If it keeps happening, tell the tradesperson who sent you this link and
            quote <span className="font-mono">{error.digest}</span>.
          </p>
        )}
      </div>
    </main>
  );
};
