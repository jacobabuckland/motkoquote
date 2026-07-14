import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
  signed_at: string | null;
  quote: {
    total: number;
    job: {
      customer: { name: string } | null;
      contractor: {
        company_name: string;
        owner_user_id: string;
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
      "id, deposit_pct, rendered_body, status, signer_name, signed_at, quote:quotes(total, job:jobs(customer:customers(name), contractor:contractors(company_name, owner_user_id, branding)))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contract) notFound();

  const {
    deposit_pct: depositPct,
    rendered_body: renderedBody,
    status,
    signer_name: signerName,
    signed_at: signedAt,
    quote,
  } = contract as unknown as ContractWithRelations;
  const { job, total: quoteTotal } = quote;

  // This page is public (fetched with the admin client so customers with the
  // link can view it). Separately, check whether the *logged-in* viewer is the
  // contractor who owns this contract — a new user commonly sends the contract
  // to their own email to test, then lands here. Without a signpost, signing
  // here silently records the customer's signature, and the contract can only
  // be signed once, which is what caused the "no option to sign" confusion.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const viewingAsOwner = user?.id === job.contractor.owner_user_id;

  const brandColor = job.contractor.branding?.brand_color ?? "#004225";
  const logoUrl = job.contractor.branding?.logo_url;
  const depositAmount = depositPct ? Math.round(quoteTotal * (depositPct / 100) * 100) / 100 : null;

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {viewingAsOwner && (
          <div className="rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <p className="font-medium">You&apos;re viewing this as your customer sees it.</p>
            <p className="mt-1 text-text-secondary">
              This is the page your customer opens to sign. Signing here records{" "}
              <strong>their</strong> signature, not a separate one from you — the contract only needs
              one signature.
            </p>
          </div>
        )}

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

        <ContractResponse
          contractId={id}
          status={status}
          signerName={signerName}
          signedAt={signedAt}
        />

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
