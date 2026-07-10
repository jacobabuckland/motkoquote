import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeQuoteTotals } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import { QuoteResponse } from "./quote-response";
import { Card } from "@/components/ui/card";

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
      branding: { brand_color?: string; footer_terms?: string } | null;
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

  const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);
  const brandColor = job.contractor.branding?.brand_color ?? "#111111";

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="mb-1 text-2xl font-semibold" style={{ color: brandColor }}>
            {job.contractor.company_name}
          </h1>
          <p className="text-sm text-text-secondary">
            Quote for {job.customer?.name ?? "you"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {lineItems.map((item, index) => (
            <Card key={index} className="flex justify-between text-sm">
              <span>{item.description}</span>
              <span className="tabular-nums">
                £{(item.quantity * item.unit_price).toFixed(2)}
              </span>
            </Card>
          ))}
        </div>

        <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Subtotal</span>
            <span className="tabular-nums">£{totals.subtotal.toFixed(2)}</span>
          </div>
          {job.contractor.vat_registered && (
            <div className="flex justify-between">
              <span className="text-text-secondary">VAT (20%)</span>
              <span className="tabular-nums">£{totals.vat.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <span>Total</span>
            <span className="tabular-nums">£{totals.total.toFixed(2)}</span>
          </div>
        </div>

        <a
          href={`/api/quotes/${id}/pdf`}
          className="self-start text-sm text-accent underline underline-offset-4"
        >
          Download PDF
        </a>

        <QuoteResponse quoteId={id} status={status} />

        {job.contractor.branding?.footer_terms && (
          <p className="text-xs text-text-muted">
            {job.contractor.branding.footer_terms}
          </p>
        )}
      </div>
    </main>
  );
}
