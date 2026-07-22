import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuoteEditor } from "./quote-editor";
import { CreateContractForm } from "@/app/dashboard/create-contract-form";
import { CreateInvoiceForm } from "@/app/dashboard/create-invoice-form";
import { synthesizeTimeline, sowStateSchema } from "@/lib/schemas/sow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { InlineLink } from "@/components/ui/inline-link";
import { StatusChip } from "@/components/ui/status-chip";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { BlockedAction } from "@/components/ui/blocked-action";
import { buttonClass } from "@/components/ui/button";
import { formatGBP, formatDate, formatMaterialsSentence } from "@/lib/format";
import { labourCrewSize } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import {
  deriveJobState,
  buildTimeline,
  type QuoteState,
  type ContractState,
  type InvoiceState,
} from "@/lib/job-stages";

const jobStatusLabel: Record<string, string> = {
  sow_in_progress: "Gathering details",
  extracted: "Working out your quote",
  drafted: "Quote ready",
};

const jobStatusTone: Record<string, "neutral" | "warning" | "success"> = {
  sow_in_progress: "warning",
  extracted: "warning",
  drafted: "success",
};

type QuoteRow = {
  id: string;
  line_items_json: unknown;
  contractor_flags_json: string[] | null;
  total: number;
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  contracts: {
    id: string;
    status: string;
    sent_at: string | null;
    signed_at: string | null;
    deposit_pct: number | null;
  }[];
  invoices: {
    id: string;
    amount: number;
    status: string;
    invoice_type: string;
    due_date: string | null;
    created_at: string;
    paid_at: string | null;
    chase_events: { channel: string; sent_at: string }[];
  }[];
};

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; channels?: string }>;
}) {
  const { id } = await params;
  const { sent, channels } = await searchParams;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, transcript, extracted_json, sow_json, status, customer:customers(name, contact), contractor:contractors(vat_registered)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const { data: quoteRaw } = await supabase
    .from("quotes")
    .select(
      "id, line_items_json, contractor_flags_json, total, status, sent_at, viewed_at, accepted_at, declined_at, created_at, contracts(id, status, sent_at, signed_at, deposit_pct), invoices(id, amount, status, invoice_type, due_date, created_at, paid_at, chase_events(channel, sent_at))",
    )
    .eq("job_id", id)
    .maybeSingle();

  const quote = (quoteRaw as unknown as QuoteRow | null) ?? null;

  const contractor = job.contractor as unknown as { vat_registered: boolean } | null;
  const customer = job.customer as unknown as {
    name: string;
    contact: { email?: string; phone?: string } | null;
  } | null;
  const extraction = job.extracted_json as {
    job_type?: string;
    scope_items?: string[];
    access_issues?: string;
    timeline?: string;
    notes?: string;
  } | null;
  // Parse (not just cast) sow_json: older jobs were written under an earlier
  // SoW shape (e.g. a flat `assumptions: string[]` instead of today's
  // `assumptions_and_unknowns`). Parsing through the schema lets missing
  // fields fall back to their defaults instead of throwing at render time.
  const sowParsed = job.sow_json ? sowStateSchema.safeParse(job.sow_json) : null;
  const sow = sowParsed?.success ? sowParsed.data : null;

  const descriptor = sow?.job_type ?? extraction?.job_type ?? "Job";
  const customerName = customer?.name ?? sow?.customer_name ?? "your customer";
  const customerEmail = customer?.contact?.email ?? sow?.customer_email ?? undefined;
  const firstName = customerName.split(" ")[0] || "your customer";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const quoteUrl = quote ? `${appUrl}/q/${quote.id}` : null;
  // Timeline crew size comes from the priced labour line when a quote exists,
  // so it can't understate the crew (the Fenland "1-person team" bug).
  const quoteLineItems = (quote?.line_items_json as LineItem[] | null) ?? [];
  const timelineCrewSize = labourCrewSize(quoteLineItems);

  // Derive the whole pipeline from existing rows — no new state storage.
  const quoteState: QuoteState = quote
    ? {
        status: quote.status,
        sent_at: quote.sent_at,
        viewed_at: quote.viewed_at,
        accepted_at: quote.accepted_at,
        declined_at: quote.declined_at,
      }
    : null;
  const contractRow = quote?.contracts?.[0] ?? null;
  const contractState: ContractState = contractRow ?? null;
  const invoices: InvoiceState[] = quote?.invoices ?? [];

  const jobState = quote ? deriveJobState(quoteState, contractState, invoices) : null;
  const timeline = quote ? buildTimeline(quoteState, contractState, invoices) : [];
  const contractUrl = jobState?.contract ? `${appUrl}/c/${jobState.contract.id}` : null;
  const paymentUrl = jobState?.activeInvoice ? `${appUrl}/i/${jobState.activeInvoice.id}` : null;
  const daysOutstanding = jobState?.activeInvoice
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(jobState.activeInvoice.created_at).getTime()) / 86_400_000,
        ),
      )
    : 0;

  // Celebratory confirmation after a send routes back here with ?sent=… —
  // states what went out, to whom, over which channels, what happens next,
  // and an explicit release so the contractor knows nothing more is needed.
  const sentChannelLabels: Record<string, string> = { email: "email", sms: "text" };
  const sentChannels = (channels ?? "")
    .split(",")
    .map((c) => sentChannelLabels[c])
    .filter((c): c is string => Boolean(c));
  const channelSuffix = sentChannels.length ? ` (${sentChannels.join(" · ")})` : "";

  const sentBanner =
    sent === "quote"
      ? {
          title: `Quote sent to ${firstName}${channelSuffix}`,
          body: "They'll get a link to view and accept it. We'll email you the moment they do. Nothing else needs you right now.",
          link: quoteUrl,
          linkLabel: "Copy quote link",
        }
      : sent === "contract"
        ? {
            title: `Contract sent to ${firstName} (email)`,
            body: "They'll review and sign it online. You'll get an email the second it's signed. Nothing else needs you until then.",
            link: contractUrl,
            linkLabel: "Copy contract link",
          }
        : sent === "invoice"
          ? {
              title: `Invoice sent to ${firstName} (email)`,
              body: "They can pay online through the link. We'll email you when the payment lands. Nothing else needs you until then.",
              link: paymentUrl,
              linkLabel: "Copy payment link",
            }
          : null;

  const moveLabel =
    jobState?.move === "contractor"
      ? "Your move"
      : jobState?.move === "customer"
        ? `Waiting on ${firstName}`
        : jobState?.situation === "paid"
          ? "Complete"
          : "Closed";
  const movePillClass =
    jobState?.move === "contractor"
      ? "bg-success-bg text-success"
      : jobState?.move === "customer"
        ? "bg-info-bg text-info"
        : "bg-surface-hover text-secondary-text";

  let nextStepTitle = "";
  let nextStepBody: ReactNode = null;

  if (jobState && quote) {
    switch (jobState.situation) {
      case "draft_quote":
        nextStepTitle = "Finish and send this quote";
        nextStepBody = (
          <div className="flex flex-col items-start gap-2">
            {/* Primary → the quote editor (#quote), NOT the statement of
                work. The SoW is the secondary text link below. */}
            <a href="#quote" className={buttonClass("primary", "self-start")}>
              Go to the quote
            </a>
            <InlineLink href={`/api/jobs/${job.id}/sow-pdf`} external target="_blank">
              View statement of work
            </InlineLink>
          </div>
        );
        break;
      case "quote_sent":
        nextStepTitle = `Waiting on ${firstName} to accept the quote`;
        nextStepBody = (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-secondary">
              {quote.viewed_at ? "They've opened it." : "They haven't opened it yet."} You&apos;ll
              get an email the moment they accept.
            </p>
            {quoteUrl && <CopyLinkButton url={quoteUrl} label="Copy quote link" />}
            <BlockedAction
              label="Send contract"
              reason={`Available once ${firstName} accepts the quote.`}
            />
          </div>
        );
        break;
      case "quote_declined":
        nextStepTitle = `${firstName} declined the quote`;
        nextStepBody = (
          <p className="text-sm text-text-secondary">
            Nothing needs you here. Start a new quote if things change.
          </p>
        );
        break;
      case "accepted_need_contract":
        nextStepTitle = "Send a contract to sign";
        nextStepBody = (
          <CreateContractForm
            quoteId={quote.id}
            jobId={job.id}
            customerName={customer?.name}
            customerEmail={customerEmail}
            initialJobInput={{
              scope_of_work: (extraction?.scope_items ?? []).join("; "),
              access_arrangements: extraction?.access_issues ?? "",
              estimated_duration: extraction?.timeline ?? "",
            }}
          />
        );
        break;
      case "contract_sent":
        nextStepTitle = `Waiting on ${firstName} to sign the contract`;
        nextStepBody = (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-secondary">
              You&apos;ll get an email as soon as it&apos;s signed.
            </p>
            {contractUrl && <CopyLinkButton url={contractUrl} label="Copy contract link" />}
            <BlockedAction label="Raise an invoice" reason="Available once the contract is signed." />
          </div>
        );
        break;
      case "contract_declined":
        nextStepTitle = `${firstName} declined the contract`;
        nextStepBody = (
          <p className="text-sm text-text-secondary">Nothing needs you here.</p>
        );
        break;
      case "signed_need_invoice":
        nextStepTitle = "Raise an invoice to get paid";
        nextStepBody = (
          <CreateInvoiceForm
            quoteId={quote.id}
            jobId={job.id}
            quoteTotal={quote.total}
            customerName={customerName}
          />
        );
        break;
      case "invoice_unpaid":
        nextStepTitle = `Waiting on ${firstName} to pay`;
        nextStepBody = (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-text-secondary">
              Sent {daysOutstanding === 0 ? "today" : `${daysOutstanding} days ago`}. You&apos;ll
              get an email the moment it&apos;s paid.
            </p>
            {paymentUrl && (
              <div className="flex flex-wrap items-center gap-3">
                <InlineLink href={paymentUrl} external>
                  Payment link
                </InlineLink>
                <CopyLinkButton url={paymentUrl} label="Copy payment link" />
              </div>
            )}
          </div>
        );
        break;
      case "invoice_overdue":
        nextStepTitle = "Payment is overdue";
        nextStepBody = (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-error">
              This invoice is past its due date. Chase {firstName} for payment.
            </p>
            {paymentUrl && (
              <div className="flex flex-wrap items-center gap-3">
                <InlineLink href={paymentUrl} external>
                  Payment link
                </InlineLink>
                <CopyLinkButton url={paymentUrl} label="Copy payment link" />
              </div>
            )}
          </div>
        );
        break;
      case "paid":
        nextStepTitle = "Job complete — you've been paid";
        nextStepBody = (
          <p className="text-sm text-text-secondary">
            Everything&apos;s settled. Nothing else to do.
          </p>
        );
        break;
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/dashboard" backLabel="Dashboard" />

      <main className="flex flex-1 justify-center p-6">
        <div className="flex w-full max-w-xl flex-col gap-6">
          {sentBanner && (
            <div className="flex flex-col gap-2 rounded-card border border-success bg-success-bg p-4">
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-success">
                  ✓
                </span>
                <h2 className="text-base font-semibold text-success">{sentBanner.title}</h2>
              </div>
              <p className="text-sm text-text-secondary">{sentBanner.body}</p>
              {sentBanner.link && (
                <CopyLinkButton url={sentBanner.link} label={sentBanner.linkLabel} />
              )}
            </div>
          )}
          {jobState && quote ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h1 className="text-2xl font-semibold">{customerName}</h1>
                  <p className="text-sm text-text-secondary">{descriptor}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular-nums text-lg font-semibold">
                    {formatGBP(quote.total)}
                  </span>
                  <StatusChip status={jobState.overallStatus} />
                </div>
              </div>

              <Card>
                <PipelineStepper stages={jobState.stages} />
              </Card>

              <Card className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    Next step
                  </h2>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${movePillClass}`}
                  >
                    {moveLabel}
                  </span>
                </div>
                <p className="text-base font-medium">{nextStepTitle}</p>
                {nextStepBody}
              </Card>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold">{descriptor}</h1>
              <Badge tone={jobStatusTone[job.status] ?? "neutral"}>
                {jobStatusLabel[job.status] ?? job.status}
              </Badge>
            </div>
          )}

          {sow && sow.rooms.length > 0 ? (
            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Scope
                </h2>
                <InlineLink
                  href={`/api/jobs/${job.id}/sow-pdf`}
                  external
                  target="_blank"
                >
                  Download PDF
                </InlineLink>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                {sow.rooms.map((room, i) => (
                  <li key={i}>
                    <span className="font-medium">{room.name}</span>
                    {room.dimensions ? ` (${room.dimensions})` : ""}
                    {room.work_items.length > 0 && (
                      <ul className="ml-2 list-inside list-disc text-text-secondary">
                        {room.work_items.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            extraction?.scope_items &&
            extraction.scope_items.length > 0 && (
              <Card className="flex flex-col gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Scope
                </h2>
                <ul className="list-inside list-disc text-sm">
                  {extraction.scope_items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </Card>
            )
          )}

          {sow && sow.additional_items.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Additional work
              </h2>
              <ul className="list-inside list-disc text-sm text-text-secondary">
                {sow.additional_items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </Card>
          )}

          {sow?.overview_narrative && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Overview
              </h2>
              <p className="text-sm text-text-secondary">{sow.overview_narrative}</p>
            </Card>
          )}

          {sow && (
            <Card className="flex flex-col gap-3">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Timeline
                </h3>
                <p className="text-sm">{synthesizeTimeline(sow, timelineCrewSize)}</p>
              </div>
              {sow.access_issues && (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    Access &amp; working constraints
                  </h3>
                  <p className="text-sm">{sow.access_issues}</p>
                </div>
              )}
              {sow.existing_conditions && (
                <div>
                  <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    Existing conditions
                  </h3>
                  <p className="text-sm">{sow.existing_conditions}</p>
                </div>
              )}
            </Card>
          )}

          {sow && (sow.inclusions.length > 0 || sow.exclusions.length > 0) && (
            <Card className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Included
                </h3>
                <ul className="mt-1 list-inside list-disc text-sm text-text-secondary">
                  {sow.inclusions.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Not included
                </h3>
                <ul className="mt-1 list-inside list-disc text-sm text-text-secondary">
                  {sow.exclusions.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          {sow && sow.materials_mentioned.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Materials
              </h2>
              <p className="text-sm text-text-secondary">
                {formatMaterialsSentence(sow.materials_mentioned)}
              </p>
            </Card>
          )}

          {sow && sow.assumptions_and_unknowns.length > 0 && (
            <Card className="flex flex-col gap-2">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Assumptions
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {sow.assumptions_and_unknowns.map((assumption, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2">
                    <span>{assumption.description}</span>
                    <span className="shrink-0 text-xs uppercase text-text-muted">
                      {assumption.treatment.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {job.transcript && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-text-secondary">
                Transcript
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-text-secondary">
                {job.transcript}
              </p>
            </details>
          )}

          {quote ? (
            <>
              <div id="quote">
                <QuoteEditor
                  jobId={job.id}
                  quoteId={quote.id}
                  initialLineItems={quote.line_items_json as never}
                  contractorFlags={quote.contractor_flags_json ?? []}
                  vatRegistered={contractor?.vat_registered ?? false}
                  initialCustomerName={sow?.customer_name ?? undefined}
                  initialCustomerEmail={sow?.customer_email ?? undefined}
                  initialCustomerPhone={sow?.customer_phone ?? undefined}
                  initialSiteAddress={sow?.site_address ?? undefined}
                />
              </div>
              <InlineLink
                href={`/api/quotes/${quote.id}/pdf`}
                external
                target="_blank"
                className="self-start"
              >
                Download quote PDF
              </InlineLink>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              Your quote is on its way — refresh in a moment.
            </p>
          )}

          {timeline.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Activity
              </h2>
              <ActivityTimeline events={timeline} />
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
