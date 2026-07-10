import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeQuoteTotals } from "@/lib/quote-math";
import { QuotePdf } from "@/lib/pdf/quote-pdf";
import type { LineItem } from "@/lib/schemas/job";

type QuoteWithRelations = {
  line_items_json: LineItem[];
  job: {
    customer: { name: string } | null;
    contractor: {
      company_name: string;
      vat_registered: boolean;
      branding: { brand_color?: string; footer_terms?: string } | null;
    };
  };
};

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: quote } = await admin
    .from("quotes")
    .select(
      "line_items_json, job:jobs(customer:customers(name), contractor:contractors(company_name, vat_registered, branding))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!quote) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { line_items_json: lineItems, job } =
    quote as unknown as QuoteWithRelations;
  const totals = computeQuoteTotals(lineItems, job.contractor.vat_registered);

  const buffer = await renderToBuffer(
    createElement(QuotePdf, {
      companyName: job.contractor.company_name,
      brandColor: job.contractor.branding?.brand_color,
      footerTerms: job.contractor.branding?.footer_terms,
      customerName: job.customer?.name ?? "Customer",
      lineItems,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
      vatRegistered: job.contractor.vat_registered,
    }) as Parameters<typeof renderToBuffer>[0],
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${id}.pdf"`,
    },
  });
};
