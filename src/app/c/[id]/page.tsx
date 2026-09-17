import { brandColorReadableAsText } from "@/lib/color-contrast";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveDeposit, depositRowLabel } from "@/lib/quote-deposit";
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
import { stripInkSignatures } from "@/lib/contracts/strip-ink-signatures";
import { contractMoney } from "@/lib/contract-money";

type ContractWithRelations = {
  id: string;
  deposit_pct: number | null;
  rendered_body: string;
  /**
   * The values the clause bodies were rendered from, frozen at send time.
   * `unknown` because it crosses the same `as unknown as` cast as everything
   * else here — `contractMoney` narrows it.
   */
  variables_json: unknown;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
  quote: {
    total: number;
    /** Migration 81. What the customer agreed on the quote, and the winner. */
    deposit_pennies: number | null;
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
      "id, deposit_pct, rendered_body, variables_json, status, signer_name, signed_at, quote:quotes(total, deposit_pennies, job:jobs(customer:customers(name), contractor:contractors(company_name, owner_user_id, branding, erased_at)))",
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
    variables_json: variablesJson,
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

  // A withdrawn contract shows a message and no signing UI
  const isWithdrawn = status === "withdrawn";
  const isDeclined = status === "declined";

  const brandColor = job.contractor.branding?.brand_color ?? "#004225";
  const logoUrl = job.contractor.branding?.logo_url;
  // THE ONE RESOLVER. The quote's recorded deposit wins; deposit_pct applies
  // only where the quote records none. Until 15 Sep this page recomputed from
  // deposit_pct alone, so a deposit agreed on the quote was absent from the
  // contract the customer signed — and then invoiced on signature anyway.
  const deposit = resolveDeposit(
    { total: quoteTotal, deposit_pennies: quote.deposit_pennies },
    { deposit_pct: depositPct },
  );
  // THE SUMMARY STATES WHAT THIS CONTRACT SAYS, not what its quote says today.
  //
  // Pass-14 SERIOUS 1: the header was computed live while the clauses below it
  // are frozen, so once the quote moved the same page carried two totals —
  // £1,800 in bold above a price clause reading £1,440. `variables_json` is
  // what those clauses were rendered FROM, so this is the document agreeing
  // with itself rather than a second opinion about it. See contract-money.ts
  // for why it applies to live contracts too.
  const money = contractMoney(variablesJson, {
    total: quoteTotal,
    deposit: deposit?.amount ?? null,
  });

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {user && <BackToDashboard />}
        {/* The owner's preview banner speaks in the present tense about an
            action that may already have happened. On a SIGNED contract it read
            "This is the page your customer opens to sign" above a confirmation
            that they had signed it days earlier — stale, and it invites the
            trade to wonder whether the signature took. Reported 13 Sep.
            The signed state gets its own sentence; the rest is unchanged. */}
        {viewingAsOwner && (
          <div className="rounded-card border border-border bg-surface px-4 py-3 text-sm">
            <p className="font-medium">You&apos;re viewing this as your customer sees it.</p>
            <p className="mt-1 text-text-secondary">
              {status === "signed" ? (
                <>
                  Your customer has already signed this. Nothing here needs anything from you — the
                  contract only ever needed <strong>their</strong> signature.
                </>
              ) : (
                <>
                  This is the page your customer opens to sign. Signing here records{" "}
                  <strong>their</strong> signature, not a separate one from you — the contract only
                  needs one signature.
                </>
              )}
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

        {/* AT THE TOP, because it governs everything below it.

            Pass 13 raised this and pass 14 found it compounding SERIOUS 1: the
            withdrawal notice sat at character 10,769 of 10,838 — after Schedule
            A, the very last line — so a customer read a full contract and its
            figures before reaching the sentence saying it no longer stands.
            The status of a document is not a footnote to it. */}
        {(isWithdrawn || isDeclined) && (
          <Card className="px-4 py-3">
            <p className="font-medium">
              {isWithdrawn
                ? `This contract has been withdrawn by ${job.contractor.company_name}`
                : "This contract was declined"}
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              It can no longer be signed. The figures below are the ones it was issued
              with.
            </p>
          </Card>
        )}

        <Card className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-text-secondary">Total quote value</span>
            <span className="tabular-nums">{formatGBP(money.total)}</span>
          </div>
          {money.deposit !== null && (
            <div className="flex justify-between">
              {/* The label carries the stated percentage, which only the live
                  resolver knows. Where it has none — a contract whose quote no
                  longer states one — "Deposit" is the honest label, and the
                  AMOUNT beside it is still the frozen one. */}
              <span className="text-text-secondary">
                {deposit ? depositRowLabel(deposit) : "Deposit"}
              </span>
              <span className="tabular-nums">{formatGBP(money.deposit)}</span>
            </div>
          )}
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
            <span className="font-medium">Balance on completion</span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatGBP(money.balance)}
            </span>
          </div>
        </Card>

        <ContractBody markdown={stripInkSignatures(renderedBody)} />

        {isWithdrawn ? null : (
          <ContractResponse
            contractId={id}
            status={status}
            signerName={signerName}
            signedAt={signedAt}
          />
        )}

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
