import { createElement } from "react";
import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { SowPdf } from "@/lib/pdf/sow-pdf";
import type { SowState } from "@/lib/schemas/sow";

type JobWithRelations = {
  sow_json: SowState | null;
  created_at: string;
  customer: { name: string } | null;
  contractor: {
    company_name: string;
    company_number: string | null;
    trade: string | null;
    vat_number: string | null;
    branding: { brand_color?: string; logo_url?: string } | null;
  };
};

export const GET = async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("jobs")
    .select(
      "sow_json, created_at, customer:customers(name), contractor:contractors(company_name, company_number, trade, vat_number, branding)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { sow_json: sow, created_at: createdAt, customer, contractor } =
    job as unknown as JobWithRelations;

  if (!sow) {
    return NextResponse.json({ error: "No statement of work for this job yet" }, { status: 404 });
  }

  const buffer = await renderToBuffer(
    createElement(SowPdf, {
      companyName: contractor.company_name,
      trade: contractor.trade,
      companyNumber: contractor.company_number,
      vatNumber: contractor.vat_number,
      brandColor: contractor.branding?.brand_color,
      logoUrl: contractor.branding?.logo_url,
      reference: id.slice(0, 8).toUpperCase(),
      date: new Date(createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      customerName: customer?.name,
      sow,
    }) as Parameters<typeof renderToBuffer>[0],
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="sow-${id}.pdf"`,
    },
  });
};
