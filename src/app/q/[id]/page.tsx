import { brandColorReadableAsText } from "@/lib/color-contrast";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPubliclyUnavailable } from "@/lib/erased-artefact";
import { createClient } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import { QuoteResponse } from "./quote-response";
import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { Monogram } from "@/components/ui/monogram";
import { BackToDashboard } from "@/components/ui/back-to-dashboard";
import { formatGBP } from "@/lib/format";
import {
  incompleteQuoteNote,
  PARTIAL_TOTAL_LABEL,
  UNPRICED_AMOUNT_LABEL,
  UNPRICED_LINE_NOTE,
} from "@/lib/unpriced-quote-copy";
import { sentQuoteDivergence } from "@/lib/sent-quote-disclosure";
import { throwIfQueryFailed } from "@/lib/query-error";
import {
  SENT_QUOTE_CHANGED_HEADING,
  sentQuoteChangedNote,
} from "@/lib/sent-quote-copy";

type QuoteWithRelations = {
  id: string;
  line_items_json: LineItem[];
  status: string;
  viewed_at: string | null;
  sent_total: number | null;
  job: {
    customer: { name: string } | null;
    contractor: {
      company_name: string;
      erased_at: string | null;
      vat_registered: boolean;
      branding: { brand_color?: string; footer_terms?: string; logo_url?: string } | null;
    };
  };
};

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: quote, error: quoteError } = await admin
    .from("quotes")
    .select(
      "id, line_items_json, status, viewed_at, sent_total, job:jobs(customer:customers(name), contractor:contractors(company_name, vat_registered, branding, erased_at))",
    )
    .eq("id", id)
    .maybeSingle();

  // A rejected query must not become a 404. When `sent_total` was named here
  // ahead of its migration, PostgREST rejected the select and every customer
  // quote link that had already been sent returned "not found" — a quote that
  // exists, told it does not. Fail loudly instead; notFound() below is reserved
  // for a link that genuinely points at nothing.
  await throwIfQueryFailed(quoteError, "Loading the public quote");

  if (!quote) notFound();

  const {
    line_items_json: lineItems,
    status,
    viewed_at: viewedAt,
    sent_total: sentTotal,
    job,
  } = quote as unknown as QuoteWithRelations;

  // An erased trade's documents stop resolving (D6 / §4.2). The customer gets
  // the same neutral not-found page as a mistyped id — nothing here discloses
  // that an account was deleted, or whose.
  if (isPubliclyUnavailable({ erasedAt: job.contractor.erased_at, status })) notFound();

  // "Viewed" only means anything once a quote has actually been sent. A draft
  // reached through its share link (contractor previewing, a crawler, a re-open)
  // must NOT be stamped as viewed — otherwise a never-sent job shows a spurious
  // "Quote viewed" in its timeline and a "Viewed" status. Guard the stamp and
  // the analytics event on the quote having left draft.
  const isSent = status !== "draft";
  if (isSent && !viewedAt) {
    await admin
      .from("quotes")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", id);
  }

  // Customer viewing a shared link is unauthenticated — record with user_id null.
  if (isSent) {
    await track("quote_viewed", { quote_id: id }, { allowAnonymous: true });
  }

  // Public capability URL; separately detect an authenticated contractor
  // previewing the quote so we can offer a way back to the dashboard. The
  // customer (unauthenticated) sees nothing new.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();

  const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);

  // A line the compiler could not price carries no figure at all. It must not
  // render as £0.00 here: the total below already excludes it, so a zero in the
  // line and a confident "Total" underneath together describe a complete quote
  // that this isn't. The PDF has said so since it was written — this is the
  // same document, said the same way.
  // What the customer was told at send, against what this page is about to
  // show them. Null unless the two actually disagree — see sentQuoteDivergence
  // for why a pre-migration quote (sent_total null) deliberately says nothing.
  const divergence = sentQuoteDivergence(sentTotal, totals.total);

  const unpricedCount = lineItems.filter((item) => item.unpriced).length;
  const hasUnpriced = unpricedCount > 0;
  const brandColor = job.contractor.branding?.brand_color ?? "#004225";
  const logoUrl = job.contractor.branding?.logo_url;

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {user && <BackToDashboard />}
        <div className="flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from Supabase storage
            <img src={logoUrl} alt={job.contractor.company_name} className="h-12 w-12 rounded-md object-contain" />
          ) : (
            <Monogram companyName={job.contractor.company_name} brandColor={brandColor} size={48} />
          )}
          <div>
            {/* The one place the brand colour paints TEXT on this page, and
                the one place it can fail — #FEF7B8 on the near-white surface
                is 1.1:1, so the trade's own name is invisible to the customer
                and the trade never sees the customer's copy. Constrain the
                design, not the input (decision, 2026-08-25): the colour is
                stored as set and still paints the monogram; this role declines
                it and inherits the page's ink instead. */}
            <h1
              className="mb-1 text-2xl font-semibold"
              style={
                brandColorReadableAsText(brandColor) ? { color: brandColor } : undefined
              }
            >
              {job.contractor.company_name}
            </h1>
            <p className="text-sm text-text-secondary">
              Quote for {job.customer?.name ?? "you"}
            </p>
          </div>
        </div>

        <Card className="flex flex-col divide-y divide-border p-0 text-sm">
          {lineItems.map((item, index) => (
            <div key={index} className="flex justify-between gap-4 px-4 py-3">
              <div className="flex flex-col gap-1">
                <span>{item.description}</span>
                {item.people && item.people.length > 1 && (
                  <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
                    {item.people.map((person, pi) => (
                      <li key={pi}>
                        {person.label} — {person.days} {person.days === 1 ? "day" : "days"}
                      </li>
                    ))}
                  </ul>
                )}
                {item.includes_tasks && item.includes_tasks.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-xs text-text-secondary">
                    {item.includes_tasks.map((task, ti) => (
                      <li key={ti}>{task}</li>
                    ))}
                  </ul>
                )}
                {item.customer_note && (
                  <span className="text-xs text-text-secondary">{item.customer_note}</span>
                )}
                {item.unpriced && (
                  <span className="text-xs font-medium">{UNPRICED_LINE_NOTE}</span>
                )}
              </div>
              <span className={item.unpriced ? "font-medium" : "tabular-nums"}>
                {item.unpriced ? UNPRICED_AMOUNT_LABEL : formatGBP(lineItemTotal(item))}
              </span>
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          {totals.subtotal !== totals.total && (
            <div className="flex justify-between">
              <span className="text-text-secondary">Subtotal</span>
              <span className="tabular-nums">{formatGBP(totals.subtotal)}</span>
            </div>
          )}
          {job.contractor.vat_registered && (
            <div className="flex justify-between">
              <span className="text-text-secondary">VAT (20%)</span>
              <span className="tabular-nums">{formatGBP(totals.vat)}</span>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-medium">{hasUnpriced ? PARTIAL_TOTAL_LABEL : "Total"}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatGBP(totals.total)}
            </span>
          </div>
          {hasUnpriced && (
            <p className="mt-2 text-xs font-medium">{incompleteQuoteNote(unpricedCount)}</p>
          )}
        </div>

        {/* Between the figures and the accept/decline control, deliberately:
            the customer meets it after the total it refers to and before the
            only action that binds them to it. Above the line items it would be
            a notice about a number they have not seen yet. */}
        {divergence && (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950"
          >
            <p className="font-medium">{SENT_QUOTE_CHANGED_HEADING}</p>
            <p className="mt-1">
              {sentQuoteChangedNote(
                job.contractor.company_name,
                divergence.sentTotal,
                divergence.currentTotal,
              )}
            </p>
          </div>
        )}

        <QuoteResponse quoteId={id} status={status} fullyPriced={!hasUnpriced} />

        <InlineLink
          href={`/api/quotes/${id}/pdf`}
          external
          target="_blank"
          className="self-start"
        >
          Download PDF
        </InlineLink>

        {job.contractor.branding?.footer_terms && (
          <p className="text-xs text-text-muted">
            {job.contractor.branding.footer_terms}
          </p>
        )}

        <MadeWithMotko />
      </div>
    </main>
  );
}
