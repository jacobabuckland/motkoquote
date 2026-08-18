"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Money } from "@/components/ui/money";
import { AccountPrompt } from "@/components/guest/account-prompt";
import { lineItemTotal } from "@/lib/quote-math";
import { readGuestArtefact, type GuestArtefact } from "@/lib/guest/session";
import {
  guestQuoteFilename,
  renderGuestQuotePdfBlob,
} from "@/lib/guest/pdf";

type ShareState = "idle" | "preparing" | "shared" | "opened" | "error";

// The guest quote: rendered in-app as a real PDF preview with a share action.
// Nothing here reads or writes a row — the artefact comes off the device, and
// the document is rendered in this browser from it.
export default function GuestQuotePage() {
  const [artefact, setArtefact] = useState<GuestArtefact | null | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [gatedAction, setGatedAction] = useState<string | null>(null);
  // Held so the object URL can be revoked on unmount rather than leaked.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtefact(readGuestArtefact());
  }, []);

  const quote = artefact?.quote ?? null;

  // Render the document once the artefact is in hand. The renderer is imported
  // on demand inside renderGuestQuotePdfBlob, so nothing about this screen is
  // in the cold-launch bundle.
  useEffect(() => {
    if (!quote) return;
    let cancelled = false;

    void (async () => {
      try {
        const blob = await renderGuestQuotePdfBlob(quote);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreviewUrl(url);
      } catch {
        if (!cancelled) {
          setPreviewError("Couldn't render the PDF preview. The figures below are still correct.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [quote]);

  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const share = async () => {
    if (!quote) return;
    setShareState("preparing");
    try {
      const blob = await renderGuestQuotePdfBlob(quote);
      const file = new File([blob], guestQuoteFilename(quote), {
        type: "application/pdf",
      });

      // File sharing inside a WKWebView is not something to assume: feature
      // detect it, and fall back to opening the document in a new tab. The
      // fallback is not an error state and never asks for an account.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Quote ${quote.reference}` });
        setShareState("shared");
        return;
      }

      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setShareState("opened");
    } catch (err) {
      // A user dismissing the system share sheet rejects with AbortError —
      // that is a cancellation, not a failure, and must not show an error.
      if (err instanceof DOMException && err.name === "AbortError") {
        setShareState("idle");
        return;
      }
      setShareState("error");
    }
  };

  if (artefact === undefined) return null;

  if (!quote) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Your quote" />
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-sm text-text-secondary">
            No quote on this device yet. Talk a job through and Motko will draft one.
          </p>
          <Link href="/start">
            <Button type="button">Start a job</Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title="Your quote"
        action={
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline underline-offset-4"
          >
            Sign in
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            {quote.jobType ?? "Your quote"}
          </h1>
          <p className="text-sm text-text-secondary">
            Ref {quote.reference} · <Money amount={quote.total} /> total
          </p>
        </div>

        {quote.unpricedLabour && (
          <Card className="flex flex-col gap-1 border-warning">
            <h2 className="text-sm font-semibold">Labour isn&apos;t priced</h2>
            <p className="text-sm text-text-secondary">
              Motko prices labour from your day rate, and you haven&apos;t given
              one. The labour line is marked as an estimate rather than showing a
              made-up figure — say a day rate on your next quote, or set your
              rates up with an account.
            </p>
          </Card>
        )}

        {/* The document itself. An <object> renders the PDF inline where the
            platform supports it and falls back to the link inside it where it
            doesn't, so the preview is never a blank rectangle. */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {previewUrl ? (
            <object
              data={previewUrl}
              type="application/pdf"
              className="h-[60vh] w-full"
              aria-label={`Quote ${quote.reference} preview`}
            >
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-sm text-text-secondary">
                  Your device can&apos;t show the PDF inline.
                </p>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-accent underline underline-offset-4"
                >
                  Open the PDF
                </a>
              </div>
            </object>
          ) : (
            <p className="p-6 text-center text-sm text-text-secondary">
              {previewError ?? "Rendering your quote…"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button type="button" onClick={() => void share()} disabled={shareState === "preparing"}>
            {shareState === "preparing"
              ? "Preparing…"
              : shareState === "shared"
                ? "Shared ✓"
                : shareState === "opened"
                  ? "Opened ✓"
                  : "Share the PDF"}
          </Button>
          {shareState === "error" && (
            <p className="text-sm text-error">
              Couldn&apos;t share that. Try opening the PDF from the preview above.
            </p>
          )}
        </div>

        <Card className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            What&apos;s in it
          </h2>
          <ul className="flex flex-col gap-2 text-sm">
            {quote.lineItems.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-4">
                <span>
                  {item.description}
                  {item.assumed && (
                    <span className="text-text-secondary"> · estimated</span>
                  )}
                </span>
                <Money amount={lineItemTotal(item)} className="shrink-0" />
              </li>
            ))}
          </ul>
        </Card>

        {/* Gated actions. Tapping one reveals the prompt in place — the quote
            above stays exactly where it is and nothing navigates. */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="secondary" onClick={() => setGatedAction("Saving this quote")}>
              Save this quote
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGatedAction("Sending to a customer")}
            >
              Send to a customer
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setGatedAction("Invoicing and getting paid")}
            >
              Invoice it
            </Button>
          </div>
          {gatedAction && <AccountPrompt action={gatedAction} />}
        </div>

        <Link href="/start" className="text-sm text-text-secondary underline underline-offset-4">
          Quote another job
        </Link>
      </main>
    </div>
  );
}
