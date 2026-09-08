// What a customer sees when their link points at nothing.
//
// There was no `not-found.tsx` anywhere in this app, so every `notFound()` on a
// customer route rendered Next's stock 404 — a bare "404 | This page could not
// be found" with no explanation and nowhere to go. A customer who mistyped a
// character, or whose link was truncated by their messaging app, had no way to
// tell that from the server being broken.
//
// DISCLOSURE. This page is reached by three different situations and must not
// distinguish them:
//
//   - an id that never existed (mistyped, truncated in transit)
//   - a quote or contract belonging to a contractor whose account was erased
//     (`isPubliclyUnavailable`)
//   - a draft reached through a shared link before it was sent
//
// The second is the one that matters. `/q/[id]` deliberately answers an erased
// trade's documents with the same neutral not-found as a mistyped id, so that
// nothing here discloses that an account was deleted, or whose. The copy below
// therefore says "no longer available" without ever saying why — and must stay
// that way.

import { MadeWithMotko } from "@/components/ui/made-with-motko";

export const CustomerLinkNotFound = ({
  /** "quote", "contract", "invoice" — what the link was meant to open. */
  document,
}: {
  document: string;
}) => (
  <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
    <div className="flex w-full max-w-sm flex-col items-start gap-3 rounded-card border border-line bg-card px-5 py-6">
      <h1 className="text-base font-semibold text-ink">This link doesn&apos;t work</h1>
      {/* Two causes, both actionable by the customer, and neither of them
          "something went wrong" — this page exists precisely to be
          distinguishable from the error boundary next to it. */}
      <p className="text-sm text-ink-secondary">
        The {document} it points to is no longer available, or the link was
        cut short on its way to you — messaging apps sometimes clip a long one.
      </p>
      <p className="text-sm text-ink-secondary">
        Check you copied the whole link, and if it still doesn&apos;t work, ask the
        tradesperson who sent it for a fresh one.
      </p>
    </div>
    <MadeWithMotko />
  </main>
);
