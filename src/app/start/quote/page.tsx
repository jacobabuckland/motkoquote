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

type ShareState = "idle" | "shared" | "unavailable" | "error";

// The guest quote: rendered in-app as a real PDF preview with a share action.
// Nothing here reads or writes a row — the artefact comes off the device, and
// the document is rendered in this browser from it.
export default function GuestQuotePage() {
  const [artefact, setArtefact] = useState<GuestArtefact | null | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The rendered document itself, not just a URL onto it. Sharing needs the
  // File in hand BEFORE the tap — see `share` below.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [gatedAction, setGatedAction] = useState<string | null>(null);
  // Held so the object URL can be revoked on unmount rather than leaked.
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtefact(readGuestArtefact());
  }, []);

  const quote = artefact?.quote ?? null;

  // Render the document once the artefact is in hand — ONCE, here, and never
  // again on tap. The renderer is imported on demand inside
  // renderGuestQuotePdfBlob, so nothing about this screen is in the cold-launch
  // bundle; that import is precisely the cost that must not be paid inside a
  // gesture handler.
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
        setPdfFile(new File([blob], guestQuoteFilename(quote), { type: "application/pdf" }));
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

  // Everything up to and including the navigator.share() call is SYNCHRONOUS.
  //
  // iOS grants a tap a transient activation window and rejects share() outside
  // it. Awaiting anything first — a dynamic import, a PDF render — closes that
  // window and the call fails with NotAllowedError, which is exactly the
  // on-device failure this shape exists to prevent. The document is therefore
  // rendered on mount and the button stays disabled until it is ready, so there
  // is never a reason to await here. Do not introduce one.
  const share = () => {
    if (!pdfFile || !quote) return;

    if (!navigator.canShare?.({ files: [pdfFile] })) {
      // File sharing inside a WKWebView is not something to assume. When it is
      // unavailable this is not an error — the Open the PDF control below is
      // always on screen and is the way out.
      setShareState("unavailable");
      return;
    }

    navigator
      .share({ files: [pdfFile], title: `Quote ${quote.reference}` })
      .then(() => setShareState("shared"))
      .catch((err: unknown) => {
        // A user dismissing the system share sheet rejects with AbortError —
        // that is a cancellation, not a failure, and must not show an error.
        if (err instanceof DOMException && err.name === "AbortError") {
          setShareState("idle");
          return;
        }
        setShareState("error");
      });
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

        {quote.unpricedMaterials && (
          <Card className="flex flex-col gap-1 border-warning">
            <h2 className="text-sm font-semibold">Material prices aren&apos;t filled in</h2>
            <p className="text-sm text-text-secondary">
              Motko has none of your supplier prices yet, so it hasn&apos;t
              guessed at them. Those lines are marked for you to fill in before
              you send this — or set your rates up with an account, and Motko
              will remember what you actually pay.
            </p>
          </Card>
        )}

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
            platform supports it. Where it doesn't, it can paint an empty box
            without ever showing fallback content — which is why the Open the
            PDF control below is a permanent part of the page and not fallback
            content buried in here. */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {previewUrl ? (
            <object
              data={previewUrl}
              type="application/pdf"
              className="h-[60vh] w-full"
              aria-label={`Quote ${quote.reference} preview`}
            >
              <p className="p-6 text-center text-sm text-text-secondary">
                Your device can&apos;t show the PDF inline. Use Open the PDF below.
              </p>
            </object>
          ) : (
            <p className="p-6 text-center text-sm text-text-secondary">
              {previewError ?? "Rendering your quote…"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {/* Disabled until the document exists. That is what keeps `share`
              free of any await — a tap can never arrive before the file does. */}
          <Button type="button" onClick={share} disabled={!pdfFile}>
            {!pdfFile
              ? "Preparing…"
              : shareState === "shared"
                ? "Shared ✓"
                : "Share the PDF"}
          </Button>

          {/* Always present, never conditional on a failure: whatever the
              platform does with share sheets or inline PDF rendering, there is
              a control on this screen that gets the document out.

              This opens a viewer IN THIS DOCUMENT. It used to be an anchor at
              the blob URL with target="_blank" and a download attribute, which
              does nothing at all inside the iOS shell: Capacitor's
              decidePolicyFor cancels any top-level navigation whose URL does
              not start with the server origin, and a blob: URL never does, so
              it was handed to UIApplication.shared.open — which has no handler
              for the blob: scheme and fails silently. Dropping target="_blank"
              does not help; a main-frame blob navigation dies the same way.
              An <object> is a subresource rather than a navigation, so it is
              allowed through — which is exactly why the inline preview above
              renders. */}
          {previewUrl && (
            <Button type="button" variant="secondary" onClick={() => setViewerOpen(true)}>
              Open the PDF
            </Button>
          )}

          {shareState === "unavailable" && (
            <p className="text-sm text-text-secondary">
              This device can&apos;t share files directly. Use Open the PDF above.
            </p>
          )}
          {shareState === "error" && (
            <p className="text-sm text-error">
              Couldn&apos;t open the share sheet. Use Open the PDF above.
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

      {/* The document, full screen, still inside this document. The close
          control is not decoration: the shell has no browser chrome, so a
          viewer without its own way back is a trap — the same reason the SOW
          got its own in-app viewer rather than a link to the PDF route. */}
      {viewerOpen && previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Quote ${quote.reference}`}
          className="fixed inset-0 z-50 flex flex-col bg-ground pt-safe"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-medium">Quote {quote.reference}</p>
            <Button type="button" variant="tertiary" onClick={() => setViewerOpen(false)}>
              Close
            </Button>
          </div>
          <object
            data={previewUrl}
            type="application/pdf"
            className="min-h-0 flex-1 w-full"
            aria-label={`Quote ${quote.reference} document`}
          >
            <p className="p-6 text-center text-sm text-text-secondary">
              Your device can&apos;t display the PDF. Use Share the PDF to send it
              somewhere that can.
            </p>
          </object>
        </div>
      )}
    </div>
  );
}
