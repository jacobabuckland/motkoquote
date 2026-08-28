import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuoteEditor } from "./quote-editor";
import { buildSentBanner } from "./sent-banner";
import { CreateContractForm } from "@/app/dashboard/create-contract-form";
import { CreateInvoiceForm } from "@/app/dashboard/create-invoice-form";
import {
  synthesizeTimeline,
  sowStateSchema,
  resolvePricingMode,
  CHECKLIST_SLOT_LABELS,
} from "@/lib/schemas/sow";
import { durationFromDays, durationHintFromTimeline } from "@/lib/contracts/dates";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { InlineLink } from "@/components/ui/inline-link";
import { StatusChip } from "@/components/ui/status-chip";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";
import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { ShareLinkButton } from "@/components/ui/share-link-button";
import { BlockedAction } from "@/components/ui/blocked-action";
import { buttonClass } from "@/components/ui/button";
import {
  formatGBP,
  formatMaterialsSentence,
  formatScopeLine,
  getRenderTime,
} from "@/lib/format";
import { labourCrewSize } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import {
  deriveJobState,
  buildTimeline,
  type QuoteState,
  type ContractState,
  type InvoiceState,
} from "@/lib/job-stages";
import { track } from "@/lib/analytics";
import { MarkAsPaidButton } from "./mark-as-paid-button";
import { paidJobFeeLine } from "@/lib/fee-copy";
import { getJobCosts } from "./cost-actions";
import { getJobPnL } from "./pnl-actions";
import { CostsSection } from "./costs-section";

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
  searchParams: Promise<{
    sent?: string;
    channels?: string;
    delivered?: string;
    payout?: string;
  }>;
}) {
  const { id } = await params;
  const { sent, channels, delivered, payout } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, transcript, extracted_json, sow_json, status, fee_amount_pennies, fee_status, fee_waived_reason, customer:customers(name, contact), contractor:contractors(vat_registered, free_jobs_remaining, business_profile)",
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

  const contractor = job.contractor as unknown as {
    vat_registered: boolean;
    free_jobs_remaining: number | null;
    business_profile: { default_warranty_period?: string | null } | null;
  } | null;

  // Fetch costs and P&L data
  const costsResult = await getJobCosts(id);
  const costs = costsResult.ok ? costsResult.data : [];
  const pnlData = await getJobPnL(id);

  // Get unique counterparty names for type-ahead
  const existingCounterparties = Array.from(
    new Set(costs.map((c) => c.counterpartyName).filter((n): n is string => n !== null))
  );
  const freeJobsRemaining = Math.max(0, contractor?.free_jobs_remaining ?? 0);

  // The fee line for the paid state, built from the fee STORED on this job at
  // settlement — never recomputed from the bands, which can change. Null when
  // there is nothing truthful to say (see paidJobFeeLine).
  const paidFeeLine = paidJobFeeLine({
    feeStatus: (job.fee_status as string | null) ?? null,
    feeAmountPennies: (job.fee_amount_pennies as number | null) ?? null,
    feeWaivedReason: (job.fee_waived_reason as string | null) ?? null,
    freeJobsRemaining,
  });

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

  // Prefill the contract form from the structured SoW (falling back to the
  // legacy extraction for older jobs), so a SoW-captured job carries its
  // materials/duration/access straight into the contract instead of arriving
  // blank. Every field stays editable in the form — this is a starting point,
  // not a lock. Warranty seeds from the contractor's standard workmanship
  // guarantee (business_profile.default_warranty_period); build-variables
  // applies the same default as a fallback, so surfacing it here just makes it
  // visible and editable.
  const contractorMaterials = sow?.materials_supply?.contractor_supplied ?? [];
  const customerMaterials = sow?.materials_supply?.customer_supplied ?? [];
  const materialsBy =
    contractorMaterials.length && !customerMaterials.length
      ? "Contractor"
      : customerMaterials.length && !contractorMaterials.length
        ? "Customer"
        : contractorMaterials.length && customerMaterials.length
          ? "Split"
          : "";
  const materialsNotes = [
    contractorMaterials.length ? `Contractor supplies: ${contractorMaterials.join(", ")}.` : null,
    customerMaterials.length ? `Customer supplies: ${customerMaterials.join(", ")}.` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
  // Seed the structured duration ONLY from a real working-day count; a prose
  // timeline (e.g. "To be confirmed before work begins.") must never become the
  // input value — that was the leak. When only prose was captured, surface it as
  // a hint under the field so the contractor fills a number in from the call.
  const initialDuration = durationFromDays(sow?.labour_plan?.duration_days ?? null);
  const durationHint = initialDuration
    ? undefined
    : durationHintFromTimeline(sow?.timeline ?? extraction?.timeline ?? "");
  const contractPrefill = {
    scope_of_work: (extraction?.scope_items ?? []).join("; "),
    access_arrangements: sow?.access_issues ?? extraction?.access_issues ?? "",
    materials_by: materialsBy,
    materials_notes: materialsNotes,
    warranty_period: contractor?.business_profile?.default_warranty_period ?? "",
  };

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
  // A pipeline whose stages had to be back-filled to stay monotonic means the
  // underlying quote/contract/invoice rows disagree about how far the job has
  // got. Render the monotonic interpretation (done in deriveStages) and log
  // the discrepancy so it can be chased down.
  if (jobState && jobState.inconsistentStages.length > 0) {
    void track("stepper_inconsistency", {
      job_id: job.id,
      quote_id: quote?.id,
      situation: jobState.situation,
      forced_stages: jobState.inconsistentStages,
    });
  }
  const timeline = quote ? buildTimeline(quoteState, contractState, invoices) : [];
  const contractUrl = jobState?.contract ? `${appUrl}/c/${jobState.contract.id}` : null;
  const paymentUrl = jobState?.activeInvoice ? `${appUrl}/i/${jobState.activeInvoice.id}` : null;
  // Captured once per request. This is a server component, so the value is
  // stable for the render; hoisting it also satisfies react-hooks/purity.
  const renderedAt = getRenderTime();
  const daysOutstanding = jobState?.activeInvoice
    ? Math.max(
        0,
        Math.floor(
          (renderedAt - new Date(jobState.activeInvoice.created_at).getTime()) / 86_400_000,
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

  const sentBanner = buildSentBanner({
    sent,
    delivered,
    payout,
    firstName,
    channelSuffix,
    quoteUrl,
    contractUrl,
    paymentUrl,
  });

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
                work. The SoW is the secondary text link below. Only offered
                when a statement of work actually exists, so a draft without
                one never shows a link that would 404 — this keeps the control
                set identical to the Scope card's download for the same job. */}
            <a href="#quote" className={buttonClass("primary", "self-start")}>
              Go to the quote
            </a>
            {sow && sow.rooms.length > 0 && (
              /* In-app viewer, NOT the PDF route directly. The PDF route is
                 authenticated, and target="_blank" inside the WKWebView hands
                 the navigation to Safari, which has no session cookie — the
                 contractor lands on /login while signed in. */
              <InlineLink href={`/jobs/${job.id}/sow`}>
                View statement of work
              </InlineLink>
            )}
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
            {quoteUrl && <ShareLinkButton url={quoteUrl} title={`Quote for ${firstName}`} label="Copy quote link" />}
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
            initialJobInput={contractPrefill}
            initialDuration={initialDuration ?? undefined}
            durationHint={durationHint}
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
            {contractUrl && <ShareLinkButton url={contractUrl} title={`Contract for ${firstName}`} label="Copy contract link" />}
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
                <ShareLinkButton url={paymentUrl} title={`Payment link for ${firstName}`} label="Copy payment link" />
              </div>
            )}
            {jobState.activeInvoice && (
              <MarkAsPaidButton
                invoiceId={jobState.activeInvoice.id}
                customerName={firstName}
                freeJobsRemaining={freeJobsRemaining}
                quoteTotal={quote.total}
              />
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
                <ShareLinkButton url={paymentUrl} title={`Payment link for ${firstName}`} label="Copy payment link" />
              </div>
            )}
            {jobState.activeInvoice && (
              <MarkAsPaidButton
                invoiceId={jobState.activeInvoice.id}
                customerName={firstName}
                freeJobsRemaining={freeJobsRemaining}
                quoteTotal={quote.total}
              />
            )}
          </div>
        );
        break;
      case "paid":
        nextStepTitle = "Job complete — you've been paid";
        nextStepBody = (
          <div className="flex flex-col gap-2">
            {paidFeeLine && (
              <p className="text-sm text-text-secondary" data-testid="paid-fee-line">
                {paidFeeLine}
              </p>
            )}
            <p className="text-sm text-text-secondary">
              Everything&apos;s settled. Nothing else to do.
            </p>
          </div>
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
                <ShareLinkButton
                  url={sentBanner.link}
                  title={
                    sent === "quote"
                      ? `Quote for ${firstName}`
                      : sent === "contract"
                        ? `Contract for ${firstName}`
                        : `Payment link for ${firstName}`
                  }
                  label={sentBanner.linkLabel}
                />
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

          {sow?.wrap_incomplete && sow.unasked_required.length > 0 && (
            // Fix 4 — the call ended before one or more must-ask slots were put
            // to the contractor (channel dropped or the wrap ask timed out).
            // Flag it rather than presenting a complete-looking quote; the edit
            // path is the quote editor below.
            <a
              href="#quote"
              className="flex flex-col gap-1 rounded-card border border-warning bg-warning-bg p-3"
            >
              <span className="text-sm font-medium text-warning">
                Call ended before{" "}
                {sow.unasked_required
                  .map((id) => CHECKLIST_SLOT_LABELS[id])
                  .join(", ")}{" "}
                {sow.unasked_required.length === 1 ? "was" : "were"} asked
              </span>
              <span className="text-sm text-text-secondary">
                The quote was drafted without it — tap to review and fill it in.
              </span>
            </a>
          )}

          {sow && sow.rooms.length > 0 ? (
            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                  Scope
                </h2>
                <InlineLink href={`/jobs/${job.id}/sow`}>
                  View statement of work
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
                          <li key={j}>{formatScopeLine(item)}</li>
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
                    <li key={i}>{formatScopeLine(item)}</li>
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
                  <li key={i}>{formatScopeLine(item)}</li>
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
                  jobTitle={descriptor}
                  initialLineItems={quote.line_items_json as never}
                  contractorFlags={quote.contractor_flags_json ?? []}
                  vatRegistered={contractor?.vat_registered ?? false}
                  draftExpected={Boolean(job.sow_json || job.transcript)}
                  initialPricingMode={resolvePricingMode(sow ?? { pricing: null }) ?? undefined}
                  initialFixedAmount={sow?.pricing?.fixed_amount ?? null}
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
                Download quote
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

          {quote && (
            <CostsSection
              jobId={id}
              userId={user.id}
              costs={costs}
              existingCounterparties={existingCounterparties}
              contractorVatRegistered={contractor?.vat_registered ?? false}
              pnlData={pnlData}
            />
          )}
        </div>
      </main>
    </div>
  );
}
