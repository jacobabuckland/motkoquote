import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { CreateInvoiceForm } from "./create-invoice-form";
import { CreateContractForm } from "./create-contract-form";
import { durationHintFromTimeline } from "@/lib/contracts/dates";
import { ArchiveQuoteButton } from "./archive-quote-button";
import { ResolvedContractRow } from "./resolved-contract-row";
import { AppHeader } from "@/components/ui/app-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineLink } from "@/components/ui/inline-link";
import { PipelineRow } from "@/components/ui/pipeline-row";
import { type StatusLabel } from "@/components/ui/status-chip";
import { buttonClass } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { formatRelative } from "@/lib/format";
import { isDateOverdue } from "@/lib/overdue";
import { type InvoiceState } from "@/lib/job-stages";
import { dashboardSection, type DashboardSection } from "@/lib/dashboard-sections";
import { MarkAsPaidButton } from "../jobs/[id]/mark-as-paid-button";
import type { BusinessProfile } from "@/lib/schemas/contract";
import { DashboardHero } from "@/components/ui/dashboard-hero";

type AcceptedQuote = {
  id: string;
  total: number;
  accepted_at: string | null;
  job: {
    id: string;
    customer: { name: string; contact: { email?: string } } | null;
    extracted_json: {
      scope_items?: string[];
      access_issues?: string;
      timeline?: string;
    } | null;
  } | null;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  declined_at: string | null;
  invoices: InvoiceState[];
  contracts: {
    id: string;
    status: string;
    sent_at: string | null;
    signed_at: string | null;
    deposit_pct: number | null;
  }[];
};

type SentContract = {
  id: string;
  status: string;
  sent_at: string | null;
  quote: { total: number; job: { id: string; customer: { name: string } | null } | null } | null;
};

type ResolvedContract = {
  id: string;
  status: string;
  signed_at: string | null;
  declined_at: string | null;
  /** Generated: coalesce(signed_at, declined_at). What the list sorts and
   *  labels by, because a signature and a decline are the same kind of event
   *  here and only differ in which column holds the date. */
  status_changed_at: string | null;
  sent_at: string | null;
  quote: { job: { id: string; customer: { name: string } | null } | null } | null;
};

type SentQuote = {
  id: string;
  total: number;
  sent_at: string | null;
  viewed_at: string | null;
  job: { id: string; customer: { name: string } | null } | null;
};

type OpenInvoice = {
  id: string;
  amount: number;
  status: string;
  invoice_type: string;
  due_date: string | null;
  created_at: string;
  quote: { total: number; job: { id: string; customer: { name: string } | null } | null } | null;
};

type DraftQuote = {
  id: string;
  total: number;
  created_at: string;
  job: { id: string; customer: { name: string } | null } | null;
};

const invoiceTypeLabel: Record<string, string> = {
  deposit: "Deposit",
  final: "Final invoice",
};

const isOverdue = (invoice: OpenInvoice) =>
  invoice.status === "sent" && isDateOverdue(invoice.due_date, Date.now());

const invoiceStatus = (invoice: OpenInvoice): StatusLabel => {
  if (isOverdue(invoice)) return "Overdue";
  if (invoice.status === "sent") return "Awaiting payment";
  return "Draft";
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: contractorRaw } = await supabase
    .from("contractors")
    .select("id, company_name, business_profile, free_jobs_remaining")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractorRaw) {
    redirect(user.user_metadata?.setup_incomplete ? "/setup/voice" : "/setup");
  }

  const contractor = contractorRaw as {
    id: string;
    company_name: string;
    business_profile: BusinessProfile;
    free_jobs_remaining: number;
  };
  const freeJobsRemaining = Math.max(0, contractor.free_jobs_remaining ?? 0);

  // Fields a contract can't do without — missing ones mean the sent
  // contract will have gaps (no address, no payment terms, etc.).
  const requiredProfileFields: { key: keyof BusinessProfile; label: string }[] = [
    { key: "registered_address", label: "business address" },
    { key: "business_structure", label: "business structure (sole trader / ltd / etc.)" },
    { key: "default_payment_terms", label: "payment terms" },
  ];
  const missingProfileFields = requiredProfileFields
    .filter(({ key }) => !contractor.business_profile?.[key])
    .map(({ label }) => label);

  // The six pipeline reads are independent, so fire them concurrently rather
  // than awaiting each in series (L5). Every list query is also capped
  // (PIPELINE_LIMIT) so one busy trade can't pull an unbounded result set — the
  // one exception is open invoices, which feeds the outstanding-total aggregate
  // below and must stay complete (the new (status, due_date) index keeps it
  // cheap).
  const PIPELINE_LIMIT = 100;
  const [
    { data: acceptedQuotesRaw },
    { data: sentContractsRaw },
    { data: resolvedContractsRaw },
    { count: archivedContractCountRaw },
    { data: sentQuotesRaw },
    { data: openInvoicesRaw },
    { data: draftQuotesRaw },
  ] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, total, status, sent_at, viewed_at, accepted_at, declined_at, job:jobs(id, customer:customers(name, contact), extracted_json), invoices(id, status, invoice_type, due_date, created_at, paid_at), contracts(id, status, sent_at, signed_at, deposit_pct)",
      )
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(PIPELINE_LIMIT),
    supabase
      .from("contracts")
      .select("id, status, sent_at, quote:quotes(total, job:jobs(id, customer:customers(name)))")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(PIPELINE_LIMIT),
    supabase
      .from("contracts")
      .select(
        "id, status, signed_at, declined_at, status_changed_at, sent_at, quote:quotes(job:jobs(id, customer:customers(name)))",
      )
      .in("status", ["signed", "declined"])
      // Archived rows are excluded HERE, not in the component. The limit below
      // counts rows the query returns, so filtering downstream would shrink the
      // visible list every time something was archived — ten fetched, three
      // hidden, seven shown — and get worse as the archive grew.
      .is("archived_at", null)
      .order("status_changed_at", { ascending: false, nullsFirst: false })
      .limit(10),
    // Count only — the rows themselves live behind the Archived link. `head`
    // means no rows cross the wire, just the count, so an archive of any size
    // costs the dashboard one number.
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .in("status", ["signed", "declined"])
      .not("archived_at", "is", null),
    supabase
      .from("quotes")
      .select("id, total, sent_at, viewed_at, job:jobs(id, customer:customers(name))")
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(PIPELINE_LIMIT),
    supabase
      .from("invoices")
      .select(
        "id, amount, status, invoice_type, due_date, created_at, quote:quotes(total, job:jobs(id, customer:customers(name)))",
      )
      .neq("status", "paid")
      .order("created_at", { ascending: false }),
    supabase
      .from("quotes")
      .select("id, total, created_at, job:jobs(id, customer:customers(name))")
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(PIPELINE_LIMIT),
  ]);

  const acceptedQuotes = (acceptedQuotesRaw ?? []) as unknown as AcceptedQuote[];

  // Section membership is derived (see dashboard-sections.ts), never
  // re-inferred here from row counts — that is what let one job appear in two
  // contradictory sections at once.
  const sectionOf = (quote: AcceptedQuote): DashboardSection =>
    dashboardSection(
      {
        status: quote.status,
        sent_at: quote.sent_at,
        viewed_at: quote.viewed_at,
        accepted_at: quote.accepted_at,
        declined_at: quote.declined_at,
      },
      quote.contracts?.[0] ?? null,
      quote.invoices ?? [],
    );

  const sections = new Map<string, DashboardSection>(
    acceptedQuotes.map((quote) => [quote.id, sectionOf(quote)]),
  );
  const quotesNeedingInvoice = acceptedQuotes.filter(
    (q) => sections.get(q.id) === "awaiting_invoice",
  );
  const quotesNeedingContract = acceptedQuotes.filter(
    (q) => sections.get(q.id) === "awaiting_contract",
  );

  const sentContracts = (sentContractsRaw ?? []) as unknown as SentContract[];
  const resolvedContracts = (resolvedContractsRaw ?? []) as unknown as ResolvedContract[];
  const archivedContractCount = archivedContractCountRaw ?? 0;
  const sentQuotes = (sentQuotesRaw ?? []) as unknown as SentQuote[];

  const openInvoices = (openInvoicesRaw ?? []) as unknown as OpenInvoice[];
  const outstandingTotal = openInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);

  const draftQuotes = (draftQuotesRaw ?? []) as unknown as DraftQuote[];

  // "Your move" = everything the contractor has to act on next.
  const yourMoveCount =
    draftQuotes.length + quotesNeedingContract.length + quotesNeedingInvoice.length;

  const isFirstRun =
    sentQuotes.length === 0 &&
    acceptedQuotes.length === 0 &&
    sentContracts.length === 0 &&
    resolvedContracts.length === 0 &&
    openInvoices.length === 0 &&
    draftQuotes.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-7 px-5 py-6">
        {/* The ledger figure is the headline. "Your work" is the h1 for
            structure but is set as an eyebrow — nothing on this screen is
            allowed to compete with the amount. */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="eyebrow mb-3">Your work</h1>
            {!isFirstRun && (
              <DashboardHero outstandingTotal={outstandingTotal} />
            )}
            {freeJobsRemaining > 0 && (
              <Link
                href="/settings"
                className="mt-3 inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-green underline underline-offset-4"
              >
                {freeJobsRemaining} free job{freeJobsRemaining === 1 ? "" : "s"} left
              </Link>
            )}
          </div>
          <Link
            href="/jobs/new"
            className={buttonClass("primary", "shrink-0")}
          >
            New quote
          </Link>
        </div>

        {isFirstRun ? (
          <Card className="flex flex-col items-start gap-3">
            <h2 className="display text-xl font-bold">Send your first quote</h2>
            <p className="max-w-prose text-sm text-ink-secondary">
              Talk through a job and Motko turns it into a priced quote you can
              send in minutes. Everything you send shows up here to track.
            </p>
            <Link href="/jobs/new" className={buttonClass("primary", "mt-1")}>
              New quote
            </Link>
          </Card>
        ) : (
          <>

            {/* YOUR MOVE — everything the contractor has to act on, first.
                This is the only section allowed to use amber. */}
            <section className="flex flex-col gap-3">
              <h2 className="display flex items-baseline gap-2 text-lg font-bold">
                Your move
                {yourMoveCount > 0 && (
                  <span className="text-sm font-bold text-amber">
                    {yourMoveCount}
                  </span>
                )}
              </h2>

              {yourMoveCount === 0 ? (
                <EmptyState
                  title="Nothing needs you right now"
                  description="When a customer accepts a quote or a job is ready to invoice, it'll show up here."
                />
              ) : (
                <>
                  {draftQuotes.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h3 className="eyebrow">Draft quotes to finish</h3>
                      {draftQuotes.map((quote) => (
                        <PipelineRow
                          key={quote.id}
                          yourMove
                          customerName={quote.job?.customer?.name ?? "Untitled quote"}
                          href={quote.job?.id ? `/jobs/${quote.job.id}` : undefined}
                          amount={quote.total > 0 ? quote.total : undefined}
                          status="Draft"
                          dateLabel={`started ${formatRelative(quote.created_at)}`}
                          action={<ArchiveQuoteButton quoteId={quote.id} />}
                        />
                      ))}
                    </div>
                  )}

                  {quotesNeedingContract.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h3 className="eyebrow">Accepted quotes awaiting contract</h3>
                      {missingProfileFields.length > 0 && (
                        <div className="keyline-move rounded-card border border-line-strong bg-amber-tint p-3 text-sm text-ink">
                          Your business details are missing:{" "}
                          {missingProfileFields.join(", ")}. Contracts sent
                          without these will have gaps.{" "}
                          <InlineLink href="/setup" inProse>Add them in Setup</InlineLink>
                        </div>
                      )}
                      {quotesNeedingContract.map((quote) => (
                        <Card
                          key={quote.id}
                          className="keyline-move flex flex-col gap-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            {quote.job?.id ? (
                              <Link
                                href={`/jobs/${quote.job.id}`}
                                className="truncate text-sm font-semibold text-ink underline underline-offset-4 decoration-line-strong"
                              >
                                {quote.job?.customer?.name ?? "Customer"}
                              </Link>
                            ) : (
                              <span className="truncate text-sm font-semibold">
                                {quote.job?.customer?.name ?? "Customer"}
                              </span>
                            )}
                            <Money amount={quote.total} />
                          </div>
                          <CreateContractForm
                            quoteId={quote.id}
                            jobId={quote.job?.id}
                            customerName={quote.job?.customer?.name}
                            customerEmail={quote.job?.customer?.contact?.email}
                            initialJobInput={{
                              scope_of_work: (quote.job?.extracted_json?.scope_items ?? []).join("; "),
                              access_arrangements: quote.job?.extracted_json?.access_issues ?? "",
                            }}
                            durationHint={durationHintFromTimeline(quote.job?.extracted_json?.timeline)}
                          />
                        </Card>
                      ))}
                    </div>
                  )}

                  {quotesNeedingInvoice.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <h3 className="eyebrow">Accepted quotes awaiting invoice</h3>
                      {quotesNeedingInvoice.map((quote) => (
                        <Card
                          key={quote.id}
                          className="keyline-move flex flex-col gap-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            {quote.job?.id ? (
                              <Link
                                href={`/jobs/${quote.job.id}`}
                                className="truncate text-sm font-semibold text-ink underline underline-offset-4 decoration-line-strong"
                              >
                                {quote.job?.customer?.name ?? "Customer"}
                              </Link>
                            ) : (
                              <span className="truncate text-sm font-semibold">
                                {quote.job?.customer?.name ?? "Customer"}
                              </span>
                            )}
                            <Money amount={quote.total} />
                          </div>
                          <CreateInvoiceForm
                            quoteId={quote.id}
                            jobId={quote.job?.id}
                            quoteTotal={quote.total}
                            customerName={quote.job?.customer?.name}
                          />
                        </Card>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* WAITING ON CUSTOMERS — nothing here needs the contractor, so
                nothing here is amber. Quiet by design. */}
            <section className="flex flex-col gap-3">
              <h2 className="display text-lg font-bold">Waiting on customers</h2>

              <div className="flex flex-col gap-2">
                <h3 className="eyebrow">Outstanding quotes</h3>
                {sentQuotes.length === 0 ? (
                  <EmptyState
                    title="Nothing waiting on a customer"
                    description="Quotes you've sent will sit here until they're viewed or accepted."
                  />
                ) : (
                  sentQuotes.map((quote) => (
                    <PipelineRow
                      key={quote.id}
                      customerName={quote.job?.customer?.name ?? "Customer"}
                      href={quote.job?.id ? `/jobs/${quote.job.id}` : undefined}
                      amount={quote.total}
                      status={quote.viewed_at ? "Viewed" : "Sent"}
                      dateLabel={
                        quote.sent_at ? `sent ${formatRelative(quote.sent_at)}` : undefined
                      }
                      action={<ArchiveQuoteButton quoteId={quote.id} />}
                    />
                  ))
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="eyebrow">Contracts awaiting signature</h3>
                {sentContracts.length === 0 ? (
                  <EmptyState
                    title="No contracts out for signature"
                    description="Once you send a contract, it'll wait here until it's signed."
                  />
                ) : (
                  sentContracts.map((contract) => (
                    <PipelineRow
                      key={contract.id}
                      customerName={contract.quote?.job?.customer?.name ?? "Customer"}
                      href={contract.quote?.job?.id ? `/jobs/${contract.quote.job.id}` : undefined}
                      amount={contract.quote?.total}
                      status="Awaiting signature"
                      dateLabel={
                        contract.sent_at ? `sent ${formatRelative(contract.sent_at)}` : undefined
                      }
                      action={
                        <InlineLink href={`/c/${contract.id}`}>View contract</InlineLink>
                      }
                    />
                  ))
                )}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="eyebrow">Unpaid invoices</h3>
                {openInvoices.length === 0 ? (
                  <EmptyState
                    title="No outstanding invoices"
                    description="Every invoice you've sent has been paid."
                  />
                ) : (
                  openInvoices.map((invoice) => (
                    <PipelineRow
                      key={invoice.id}
                      // An overdue invoice needs chasing — that's the
                      // contractor's move, so it earns the amber keyline even
                      // though it sits in the "waiting" section.
                      yourMove={isOverdue(invoice)}
                      customerName={invoice.quote?.job?.customer?.name ?? "Customer"}
                      href={invoice.quote?.job?.id ? `/jobs/${invoice.quote.job.id}` : undefined}
                      descriptor={invoiceTypeLabel[invoice.invoice_type] ?? invoice.invoice_type}
                      amount={invoice.amount}
                      status={invoiceStatus(invoice)}
                      dateLabel={
                        invoice.due_date ? `due ${formatRelative(invoice.due_date)}` : undefined
                      }
                      action={
                        <div className="flex flex-col items-end gap-1">
                          <InlineLink href={`/i/${invoice.id}`} external>
                            Payment link
                          </InlineLink>
                          {invoice.status === "sent" && (
                            <MarkAsPaidButton
                              asLink
                              invoiceId={invoice.id}
                              customerName={
                                invoice.quote?.job?.customer?.name?.split(" ")[0] ?? "your customer"
                              }
                              freeJobsRemaining={freeJobsRemaining}
                              quoteTotal={invoice.quote?.total ?? invoice.amount}
                            />
                          )}
                        </div>
                      }
                    />
                  ))
                )}
              </div>
            </section>

            {/* HISTORY — resolved contracts, neither move. The quietest thing
                on the screen: no card, no fill, just a ruled list. Terminal
                states carry the stamp. */}
            {/* `|| archivedContractCount > 0` so archiving the LAST visible
                contract does not take the way back to the archive with it. The
                section would otherwise vanish the moment it emptied, stranding
                everything the contractor had just tidied away with no route to
                it. */}
            {(resolvedContracts.length > 0 || archivedContractCount > 0) && (
              <section className="flex flex-col gap-2">
                <h2 className="eyebrow">Signed &amp; declined contracts</h2>
                {/* overflow-hidden so the revealed Archive track is clipped by
                    the card's rounded edge rather than escaping it. */}
                <div className="flex flex-col overflow-hidden rounded-card border border-line-strong bg-card">
                  {resolvedContracts.map((contract) => (
                    <ResolvedContractRow
                      key={contract.id}
                      contractId={contract.id}
                      customerName={contract.quote?.job?.customer?.name ?? "Customer"}
                      status={contract.status}
                      statusDate={contract.status_changed_at}
                      jobId={contract.quote?.job?.id}
                    />
                  ))}
                </div>
                {/* Only once there is an archive to look at. An empty view
                    reached by a permanent link is a dead end that teaches the
                    contractor the link is not worth pressing. */}
                {archivedContractCount > 0 && (
                  <div className="flex justify-end">
                    <InlineLink href="/dashboard/archived-contracts">
                      Archived ({archivedContractCount})
                    </InlineLink>
                  </div>
                )}
              </section>
            )}

            {/* Completed and archived jobs have no home on the dashboard —
                they live in My work. Link straight to those filtered views. */}
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line-strong pt-3 text-sm">
              <InlineLink href="/jobs">All jobs</InlineLink>
              <InlineLink href="/jobs?filter=completed">Completed</InlineLink>
              <InlineLink href="/jobs?filter=archived">Archived</InlineLink>
            </nav>
          </>
        )}
      </main>
    </div>
  );
}
