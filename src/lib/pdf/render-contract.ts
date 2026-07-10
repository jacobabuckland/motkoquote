import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { createAdminClient } from "@/lib/supabase/admin";
import { ContractPdf } from "@/lib/pdf/contract-pdf";

type ContractWithRelations = {
  id: string;
  deposit_pct: number | null;
  terms_text: string;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
  created_at: string;
  quote: {
    total: number;
    job: {
      customer: { name: string } | null;
      contractor: {
        company_name: string;
        company_number: string | null;
        trade: string | null;
        vat_registered: boolean;
        vat_number: string | null;
        branding: { brand_color?: string; logo_url?: string } | null;
      };
    };
  };
};

// Shared by the contract-PDF download route and the contract email
// attachment, mirroring render-quote.ts's pattern.
export const renderContractPdf = async (contractId: string): Promise<Buffer | null> => {
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select(
      "id, deposit_pct, terms_text, status, signer_name, signed_at, created_at, quote:quotes(total, job:jobs(customer:customers(name), contractor:contractors(company_name, company_number, trade, vat_registered, vat_number, branding)))",
    )
    .eq("id", contractId)
    .maybeSingle();

  if (!contract) return null;

  const {
    deposit_pct: depositPct,
    terms_text: termsText,
    status,
    signer_name: signerName,
    signed_at: signedAt,
    created_at: createdAt,
    quote,
  } = contract as unknown as ContractWithRelations;
  const { job, total: quoteTotal } = quote;

  return renderToBuffer(
    createElement(ContractPdf, {
      companyName: job.contractor.company_name,
      trade: job.contractor.trade,
      companyNumber: job.contractor.company_number,
      vatNumber: job.contractor.vat_number,
      brandColor: job.contractor.branding?.brand_color,
      logoUrl: job.contractor.branding?.logo_url,
      reference: contractId.slice(0, 8).toUpperCase(),
      date: new Date(createdAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
      customerName: job.customer?.name ?? "Customer",
      quoteTotal,
      depositPct,
      termsText,
      status,
      signerName,
      signedAt: signedAt
        ? new Date(signedAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null,
    }) as Parameters<typeof renderToBuffer>[0],
  );
};
