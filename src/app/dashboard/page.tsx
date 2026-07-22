import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { CreateInvoiceForm } from "./create-invoice-form";
import { CreateContractForm } from "./create-contract-form";
import { ArchiveQuoteButton } from "./archive-quote-button";
import { AppHeader } from "@/components/ui/app-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineLink } from "@/components/ui/inline-link";
import { PipelineRow } from "@/components/ui/pipeline-row";
import { StatusChip, type StatusLabel } from "@/components/ui/status-chip";
import { buttonClass } from "@/components/ui/button";
import { formatGBP, formatRelative } from "@/lib/format";
import type { BusinessProfile } from "@/lib/schemas/contract";

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
  invoices: { id: string }[];
  contracts: { id: string }[];
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
  quote: { job: { id: string; customer: { name: string } | null } | null } | null;
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
  invoice.status === "sent" &&
  invoice.due_date !== null &&
  new Date(invoice.due_date).getTime() < Date.now();

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

  const { data: acceptedQuotesRaw } = await supabase
    .from("quotes")
    .select(
      "id, total, accepted_at, job:jobs(id, customer:customers(name, contact), extracted_json), invoices(id), contracts(id)",
    )
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false });

  const acceptedQuotes = (acceptedQuotesRaw ?? []) as unknown as AcceptedQuote[];
  const quotesNeedingInvoice = acceptedQuotes.filter((q) => (q.invoices ?? []).length === 0);
  const quotesNeedingContract = acceptedQuotes.filter((q) => (q.contracts ?? []).length === 0);

  const { data: sentContractsRaw } = await supabase
    .from("contracts")
    .select("id, status, sent_at, quote:quotes(total, job:jobs(id, customer:customers(name)))")
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  const sentContracts = (sentContractsRaw ?? []) as unknown as SentContract[];

  const { data: resolvedContractsRaw } = await supabase
    .from("contracts")
    .select("id, status, signed_at, sent_at, quote:quotes(job:jobs(id, customer:customers(name)))")
    .in("status", ["signed", "declined"])
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(10);

  const resolvedContracts = (resolvedContractsRaw ?? []) as unknown as ResolvedContract[];

  const { data: sentQuotesRaw } = await supabase
    .from("quotes")
    .select("id, total, sent_at, viewed_at, job:jobs(id, customer:customers(name))")
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  const sentQuotes = (sentQuotesRaw ?? []) as unknown as SentQuote[];

  const { data: openInvoicesRaw } = await supabase
    .from("invoices")
    .select(
      "id, amount, status, invoice_type, due_date, created_at, quote:quotes(job:jobs(id, customer:customers(name)))",
    )
    .neq("status", "paid")
    .order("created_at", { ascending: false });

  const openInvoices = (openInvoicesRaw ?? []) as unknown as OpenInvoice[];
  const outstandingTotal = openInvoices.reduce((sum, invoice) => sum + invoice.amount, 0);

  const { data: draftQuotesRaw } = await supabase
    .from("quotes")
    .select("id, total, created_at, job:jobs(id, customer:customers(name))")
    .eq("status", "draft")
    .order("created_at", { ascending: false });

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
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold">Your work</h1>
            {freeJobsRemaining > 0 && (
              <Link
                href="/settings"
                className="inline-flex w-fit items-center gap-1 rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {freeJobsRemaining} free job{freeJobsRemaining === 1 ? "" : "s"} left
              </Link>
            )}
          </div>
          <Link href="/jobs/new" className={buttonClass("primary")}>
            New quote
          </Link>
        </div>

        {isFirstRun ? (
          <Card className="flex flex-col items-start gap-3">
            <h2 className="text-lg font-semibold">Send your first quote</h2>
            <p className="text-sm text-secondary-text">
              Talk through a job and Motko turns it into a priced quote you can
              send in minutes. Everything you send shows up here to track.
            </p>
            <Link href="/jobs/new" className={buttonClass("primary")}>
              New quote
            </Link>
          </Card>
        ) : (
          <>
            {/* YOUR MOVE — everything the contractor has to act on, first. */}
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">
                Your move{yourMoveCount > 0 ? ` (${yourMoveCount})` : ""}
              </h2>

              {yourMoveCount === 0 ? (
                <EmptyState title="Nothing needs you right now" />
              ) : (
                <>
                  {draftQuotes.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                        Draft quotes to finish
                      </h3>
                      {draftQuotes.map((quote) => (
                        <PipelineRow
                          key={quote.id}
                          customerName={quote.job?.customer?.name ?? "Draft quote"}
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
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                        Accepted quotes awaiting contract
                      </h3>
                      {missingProfileFields.length > 0 && (
                        <div className="rounded-card border border-warning bg-warning-bg p-3 text-sm text-warning">
                          Your business details are missing: {missingProfileFields.join(", ")}.
                          Contracts sent without these will have gaps.{" "}
                          <InlineLink href="/setup" className="text-warning">
                            Add them in Setup
                          </InlineLink>
                          .
                        </div>
                      )}
                      {quotesNeedingContract.map((quote) => (
                        <Card key={quote.id} className="flex flex-col gap-3">
                          <div className="flex items-center justify-between text-sm">
                            {quote.job?.id ? (
                              <Link
                                href={`/jobs/${quote.job.id}`}
                                className="font-medium text-primary hover:text-primary-hover hover:underline"
                              >
                                {quote.job?.customer?.name ?? "Customer"}
                              </Link>
                            ) : (
                              <span>{quote.job?.customer?.name ?? "Customer"}</span>
                            )}
                            <span className="tabular-nums font-medium">
                              {formatGBP(quote.total)}
                            </span>
                          </div>
                          <CreateContractForm
                            quoteId={quote.id}
                            jobId={quote.job?.id}
                            customerName={quote.job?.customer?.name}
                            customerEmail={quote.job?.customer?.contact?.email}
                            initialJobInput={{
                              scope_of_work: (quote.job?.extracted_json?.scope_items ?? []).join("; "),
                              access_arrangements: quote.job?.extracted_json?.access_issues ?? "",
                              estimated_duration: quote.job?.extracted_json?.timeline ?? "",
                            }}
                          />
                        </Card>
                      ))}
                    </div>
                  )}

                  {quotesNeedingInvoice.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                        Accepted quotes awaiting invoice
                      </h3>
                      {quotesNeedingInvoice.map((quote) => (
                        <Card key={quote.id} className="flex flex-col gap-3">
                          <div className="flex items-center justify-between text-sm">
                            {quote.job?.id ? (
                              <Link
                                href={`/jobs/${quote.job.id}`}
                                className="font-medium text-primary hover:text-primary-hover hover:underline"
                              >
                                {quote.job?.customer?.name ?? "Customer"}
                              </Link>
                            ) : (
                              <span>{quote.job?.customer?.name ?? "Customer"}</span>
                            )}
                            <span className="tabular-nums font-medium">
                              {formatGBP(quote.total)}
                            </span>
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

            {/* WAITING ON CUSTOMERS — nothing here needs the contractor. */}
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Waiting on customers</h2>

              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                  Outstanding quotes
                </h3>
                {sentQuotes.length === 0 ? (
                  <EmptyState
                    title="Nothing waiting on a customer"
                    description="Quotes you've sent will show up here until they're viewed or accepted."
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

              <div className="flex flex-col gap-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                  Contracts awaiting signature
                </h3>
                {sentContracts.length === 0 ? (
                  <EmptyState title="Nothing waiting on a customer" />
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

              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                    Unpaid invoices
                  </h3>
                  {openInvoices.length > 0 && (
                    <span className="tabular-nums text-sm font-semibold">
                      {formatGBP(outstandingTotal)}
                    </span>
                  )}
                </div>
                {openInvoices.length === 0 ? (
                  <EmptyState title="No outstanding invoices" />
                ) : (
                  openInvoices.map((invoice) => (
                    <PipelineRow
                      key={invoice.id}
                      customerName={invoice.quote?.job?.customer?.name ?? "Customer"}
                      href={invoice.quote?.job?.id ? `/jobs/${invoice.quote.job.id}` : undefined}
                      descriptor={invoiceTypeLabel[invoice.invoice_type] ?? invoice.invoice_type}
                      amount={invoice.amount}
                      status={invoiceStatus(invoice)}
                      dateLabel={
                        invoice.due_date ? `due ${formatRelative(invoice.due_date)}` : undefined
                      }
                      action={
                        <InlineLink href={`/i/${invoice.id}`} external>
                          Payment link
                        </InlineLink>
                      }
                    />
                  ))
                )}
              </div>
            </section>

            {/* HISTORY — resolved contracts, neither move. */}
            {resolvedContracts.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-secondary-text">
                  Signed &amp; declined contracts
                </h2>
                {resolvedContracts.map((contract) => (
                  <Card key={contract.id} className="flex items-center justify-between">
                    {contract.quote?.job?.id ? (
                      <Link
                        href={`/jobs/${contract.quote.job.id}`}
                        className="text-sm font-medium text-primary hover:text-primary-hover hover:underline"
                      >
                        {contract.quote?.job?.customer?.name ?? "Customer"}
                      </Link>
                    ) : (
                      <span className="text-sm">
                        {contract.quote?.job?.customer?.name ?? "Customer"}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <StatusChip status={contract.status === "signed" ? "Signed" : "Declined"} />
                      <InlineLink href={`/c/${contract.id}`}>View contract</InlineLink>
                    </div>
                  </Card>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
