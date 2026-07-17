import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { track } from "@/lib/analytics";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import { QuoteResponse } from "./quote-response";
import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { PoweredByMotko } from "@/components/ui/powered-by-motko";
import { formatGBP } from "@/lib/format";

type QuoteWithRelations = {
  id: string;
  line_items_json: LineItem[];
  status: string;
  viewed_at: string | null;
  job: {
    customer: { name: string } | null;
    contractor: {
      company_name: string;
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

  const { data: quote } = await admin
    .from("quotes")
    .select(
      "id, line_items_json, status, viewed_at, job:jobs(customer:customers(name), contractor:contractors(company_name, vat_registered, branding))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!quote) notFound();

  const {
    line_items_json: lineItems,
    status,
    viewed_at: viewedAt,
    job,
  } = quote as unknown as QuoteWithRelations;

  if (!viewedAt) {
    await admin
      .from("quotes")
      .update({ viewed_at: new Date().toISOString() })
      .eq("id", id);
  }

  // Customer viewing a shared link is unauthenticated — record with user_id null.
  await track("quote_viewed", { quote_id: id }, { allowAnonymous: true });

  const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);
  const brandColor = job.contractor.branding?.brand_color ?? "#004225";
  const logoUrl = job.contractor.branding?.logo_url;

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from Supabase storage
            <img src={logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
          )}
          <div>
            <h1 className="mb-1 text-2xl font-semibold" style={{ color: brandColor }}>
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
              <span>{item.description}</span>
              <span className="tabular-nums">
                {formatGBP(lineItemTotal(item))}
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
            <span className="font-medium">Total</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatGBP(totals.total)}
            </span>
          </div>
        </div>

        <QuoteResponse quoteId={id} status={status} />

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

        <PoweredByMotko />
      </div>
    </main>
  );
}
