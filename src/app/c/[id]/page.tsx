import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ContractResponse } from "./contract-response";
import { Card } from "@/components/ui/card";

type ContractWithRelations = {
  id: string;
  deposit_pct: number | null;
  terms_text: string;
  status: string;
  signer_name: string | null;
  quote: {
    total: number;
    job: {
      customer: { name: string } | null;
      contractor: { company_name: string; branding: { brand_color?: string } | null };
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
      "id, deposit_pct, terms_text, status, signer_name, quote:quotes(total, job:jobs(customer:customers(name), contractor:contractors(company_name, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contract) notFound();

  const {
    deposit_pct: depositPct,
    terms_text: termsText,
    status,
    signer_name: signerName,
    quote,
  } = contract as unknown as ContractWithRelations;
  const { job, total: quoteTotal } = quote;

  const brandColor = job.contractor.branding?.brand_color ?? "#111111";
  const depositAmount = depositPct ? Math.round(quoteTotal * (depositPct / 100) * 100) / 100 : null;

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div>
          <h1 className="mb-1 text-2xl font-semibold" style={{ color: brandColor }}>
            {job.contractor.company_name}
          </h1>
          <p className="text-sm text-text-secondary">
            Contract for {job.customer?.name ?? "you"}
          </p>
        </div>

        <Card className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Total quote value</span>
            <span className="tabular-nums">£{quoteTotal.toFixed(2)}</span>
          </div>
          {depositAmount !== null && (
            <div className="flex justify-between">
              <span className="text-text-secondary">Deposit ({depositPct}%)</span>
              <span className="tabular-nums">£{depositAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <span>Balance on completion</span>
            <span className="tabular-nums">£{(quoteTotal - (depositAmount ?? 0)).toFixed(2)}</span>
          </div>
        </Card>

        <p className="text-sm text-text-secondary">{termsText}</p>

        <a
          href={`/api/contracts/${id}/pdf`}
          className="self-start text-sm text-accent underline underline-offset-4"
        >
          Download PDF
        </a>

        <ContractResponse contractId={id} status={status} signerName={signerName} />
      </div>
    </main>
  );
}
