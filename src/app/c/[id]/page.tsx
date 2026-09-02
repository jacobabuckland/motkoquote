import { brandColorReadableAsText } from "@/lib/color-contrast";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPubliclyUnavailable } from "@/lib/erased-artefact";
import { createClient } from "@/lib/supabase/server";
import { ContractResponse } from "./contract-response";
import { ContractBody } from "./contract-body";
import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { MadeWithMotko } from "@/components/ui/made-with-motko";
import { Monogram } from "@/components/ui/monogram";
import { BackToDashboard } from "@/components/ui/back-to-dashboard";
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
        owner_user_id: string | null;
        branding: { brand_color?: string; logo_url?: string } | null;
        erased_at: string | null;
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
      "id, deposit_pct, rendered_body, status, signer_name, signed_at, quote:quotes(total, job:jobs(customer:customers(name), contractor:contractors(company_name, owner_user_id, branding, erased_at)))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contract) notFound();

  // An erased trade's documents stop resolving (D6 / §4.2). A customer's saved
  // link must not keep rendering a contract nobody is left to honour, and the
  // page it lands on says only that the link is no longer available — never
  // that an account was deleted, and never whose.
  const resolved = contract as unknown as ContractWithRelations;
  if (
    isPubliclyUnavailable({
      erasedAt: resolved.quote.job.contractor.erased_at,
      status: resolved.status,
    })
  ) {
    notFound();
  }

  const {
    deposit_pct: depositPct,
    rendered_body: renderedBody,
    status,
    signer_name: signerName,
    signed_at: signedAt,
    quote,
  } = resolved;
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
        {user && <BackToDashboard />}
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
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- contractor-uploaded logo from arbitrary storage URL
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

        <MadeWithMotko />
      </div>
    </main>
  );
}
