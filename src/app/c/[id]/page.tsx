import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ContractResponse } from "./contract-response";
import { ContractBody } from "./contract-body";
import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { PoweredByMotko } from "@/components/ui/powered-by-motko";
import { formatGBP } from "@/lib/format";

type ContractWithRelations = {
  id: string;
  deposit_pct: number | null;
  rendered_body: string;
  status: string;
  signer_name: string | null;
  quote: {
    total: number;
    job: {
      customer: { name: string } | null;
      contractor: {
        company_name: string;
        branding: { brand_color?: string; logo_url?: string } | null;
      };
    };
  };
};

export default async function PublicContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data: contract } = await admin
    .from("contracts")
    .select(
      "id, deposit_pct, rendered_body, status, signer_name, quote:quotes(total, job:jobs(customer:customers(name), contractor:contractors(company_name, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contract) notFound();

  const {
    deposit_pct: depositPct,
    rendered_body: renderedBody,
    status,
    signer_name: signerName,
    quote,
  } = contract as unknown as ContractWithRelations;
  const { job, total: quoteTotal } = quote;

  const brandColor = job.contractor.branding?.brand_color ?? "#004225";
  const logoUrl = job.contractor.branding?.logo_url;
  const depositAmount = depositPct ? Math.round(quoteTotal * (depositPct / 100) * 100) / 100 : null;

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from arbitrary storage URL
            <img src={logoUrl} alt="" className="h-12 w-12 rounded-md object-contain" />
          )}
          <div>
            <h1 className="mb-1 text-2xl font-semibold" style={{ color: brandColor }}>
              {job.contractor.company_name}
            </h1>
            <p className="text-sm text-text-secondary">
              Contract for {job.customer?.name ?? "you"}
            </p>
          </div>
        </div>

        <Card className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Total quote value</span>
            <span className="tabular-nums">{formatGBP(quoteTotal)}</span>
          </div>
          {depositAmount !== null && (
            <div className="flex justify-between">
              <span className="text-text-secondary">Deposit ({depositPct}%)</span>
              <span className="tabular-nums">{formatGBP(depositAmount)}</span>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
            <span className="font-medium">Balance on completion</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatGBP(quoteTotal - (depositAmount ?? 0))}
            </span>
          </div>
        </Card>

        <ContractBody markdown={renderedBody} />

        <ContractResponse contractId={id} status={status} signerName={signerName} />

        <InlineLink
          href={`/api/contracts/${id}/pdf`}
          external
          target="_blank"
          className="self-start"
        >
          Download PDF
        </InlineLink>

        <PoweredByMotko />
      </div>
    </main>
  );
}
