"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineLink } from "@/components/ui/inline-link";

/**
 * How long before the wait stops being ordinary and says so.
 *
 * /api/jobs/[id]/sow-pdf renders on demand: getUser(), an RLS-scoped select, an
 * admin select, then renderToBuffer, in sequence, cached nowhere — so every
 * view pays the whole cost. Measured on motko.app on 21 Sep at about eight
 * seconds.
 *
 * Six seconds is past the point where a contractor on site has decided it is
 * broken, and short enough that the message still lands while they are looking.
 * It changes what is SAID, never what is shown.
 */
const SLOW_AFTER_MS = 6_000;

type State =
  | { phase: "loading" }
  | { phase: "ready"; src: string }
  | { phase: "failed" };

/**
 * The statement of work, and an honest account of the wait for it.
 *
 * WHAT THIS REPLACES. The `<object>` was rendered bare, pointed straight at the
 * API route. Its children — the "this device can't show the PDF inline"
 * fallback — are shown only when the resource CANNOT be displayed, never while
 * it is on its way, so for the whole eight seconds there was nothing in it.
 * Reported 21 Sep as "a large empty bordered rectangle — no spinner, no
 * skeleton, no 'loading'", on a phone, on site, where it reads as broken.
 *
 * It was not even blank. Reproduced in Chromium at 420x860 against a PDF held
 * back eight seconds: the element paints a solid dark panel, because Chrome's
 * PDF viewer has initialised with no document to show. Which is the same
 * report's second observation — "the thumbnail rail shows page 1 but the main
 * pane renders black" — caught a moment later in the same sequence, rather than
 * a separate rendering fault.
 *
 * WHY THE BYTES ARE FETCHED HERE rather than left to the embed. The obvious fix
 * is a skeleton laid over the object, and it does not work: a live PDF embed
 * owns its rectangle in the compositing tree. Measured — with the overlay at
 * `z-index: 10` over an object at `z-index: 0`, and again with the object at
 * `opacity: 0`, the overlay had correct geometry and colour in the DOM
 * (372x602, rgb(231,229,228)) and painted nothing at all. So the embed is not
 * mounted until there is a document for it to show, which is the one
 * arrangement that never puts anything on top of a PDF surface.
 *
 * It also buys the failure case, which did not exist: a route returning 401,
 * 404 or 500 used to leave that same dark panel forever, with no way to tell a
 * slow render from a dead one.
 *
 * NOT VERIFIED ON iOS. Blob URLs inside an `<object>` are not something this
 * environment can exercise in a WKWebView, and the Capacitor shell is a real
 * target. If the embed cannot show a blob there, the object's own children
 * still render — and "Open the PDF full screen" beneath it points at the route
 * itself and is unaffected either way.
 */
export const SowDocument = ({ pdfHref }: { pdfHref: string }) => {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    // Same-origin, so the session cookie rides along exactly as it did when the
    // embed fetched this itself. That cookie is the whole reason this page
    // exists — see the note in page.tsx.
    const abort = new AbortController();
    let objectUrl: string | null = null;

    fetch(pdfHref, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ phase: "ready", src: objectUrl });
      })
      .catch((error: unknown) => {
        // An abort is this component unmounting, not a failure. Reporting it
        // would flash an error on the way out of the page.
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ phase: "failed" });
      });

    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfHref]);

  useEffect(() => {
    if (state.phase !== "loading") return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state.phase]);

  if (state.phase === "ready") {
    return (
      // object, not iframe: it degrades to its children when the client cannot
      // display a PDF inline, which is the fallback below rather than a blank
      // frame with no way forward.
      <object
        data={state.src}
        type="application/pdf"
        aria-label="Statement of work"
        className="h-[70vh] w-full rounded-card border border-line"
      >
        <div className="flex flex-col gap-2 p-4">
          <p className="text-sm text-text-secondary">
            This device can&apos;t show the PDF inline.
          </p>
          <InlineLink href={pdfHref}>Open the statement of work</InlineLink>
        </div>
      </object>
    );
  }

  return (
    <div
      className="relative flex h-[70vh] w-full flex-col items-center justify-center gap-3"
      // Announced rather than silent: a contractor using a screen reader got
      // nothing at all from the bare object, and gets each change of state here.
      aria-live="polite"
      data-testid="sow-loading"
    >
      <Skeleton className="absolute inset-0 h-full w-full rounded-card" />
      {state.phase === "failed" ? (
        <>
          <p className="relative text-sm text-text-secondary">
            Couldn&apos;t load the statement of work.
          </p>
          <InlineLink href={pdfHref} className="relative">
            Try opening it full screen
          </InlineLink>
        </>
      ) : (
        <>
          <p className="relative text-sm text-text-secondary">
            {slow ? "Still preparing this document…" : "Preparing this document…"}
          </p>
          {slow && (
            <InlineLink href={pdfHref} className="relative">
              Open it full screen instead
            </InlineLink>
          )}
        </>
      )}
    </div>
  );
};
