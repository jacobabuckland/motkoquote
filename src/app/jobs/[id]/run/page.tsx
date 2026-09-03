import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { throwIfQueryFailed } from "@/lib/query-error";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InlineLink } from "@/components/ui/inline-link";
import { formatGBP } from "@/lib/format";
import { lineItemTotal } from "@/lib/quote-math";
import { compareRun, traceStatedPrices, type StatedPriceTrace } from "@/lib/run-view";
import type { LineItem } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";
import type { TranscriptTurn } from "@/lib/voice-transcript";
import { ReportRunProblem } from "./report-run-problem";

// The run viewer: one page showing every stage a voice intake passed through,
// in the order it passed through them.
//
// Why it exists. Everything below is already stored — turns, transcript, SoW,
// extraction, drafted lines, final lines, provenance — and none of it was
// rendered anywhere. Answering "the customer was quoted £5,000 on the call and
// the quote says £5.00, where did that go?" meant a database session and four
// jsonb blobs read side by side. It is now a page, and the answer is the
// stated-price trace in the SoW pane.
//
// Scope. Contractor-scoped through RLS, exactly like every other job route: a
// contractor sees runs for jobs they own, and an id belonging to another tenant
// 404s indistinguishably from one that does not exist. There is deliberately no
// cross-tenant view here — that needs an admin role the schema does not have,
// and inventing one on a page that renders customer PII is not a thing to do
// quietly. See areas/motko.md.

type Props = { params: Promise<{ id: string }> };

const Pane = ({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-2">
    <div className="flex flex-col gap-0.5">
      <h2 className="text-sm font-semibold">
        {step}. {title}
      </h2>
      <p className="text-xs text-text-secondary">{subtitle}</p>
    </div>
    <Card className="flex flex-col gap-3 text-sm">{children}</Card>
  </section>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-text-secondary">{children}</p>
);

const traceTone = (stage: StatedPriceTrace["stage"]): "success" | "neutral" | "error" => {
  if (stage === "in-final") return "success";
  if (stage === "not-expected") return "neutral";
  return "error";
};

const traceLabel = (stage: StatedPriceTrace["stage"]): string => {
  if (stage === "in-final") return "In the quote";
  if (stage === "not-expected") return "Not expected";
  if (stage === "lost-at-drafting") return "Lost at drafting";
  return "Lost after drafting";
};

// Provenance is written on every drafted line and gates the send, and until now
// rendered nowhere at all — so nobody could see which line came from the
// contractor's own words and which the drafter introduced.
const LineRow = ({ item }: { item: LineItem }) => {
  const provenance = item.provenance;
  return (
    <li className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{item.description}</span>
        <span className="shrink-0 tabular-nums">
          {item.unpriced === true ? "No rate" : formatGBP(lineItemTotal(item))}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <span>
          {item.quantity} {item.unit} · {item.category}
        </span>
        {item.provisional === true ? <Badge tone="warning">Provisional</Badge> : null}
        {item.assumed === true ? <Badge tone="warning">Assumed</Badge> : null}
        {item.edited === true ? <Badge tone="neutral">Edited</Badge> : null}
        <Badge tone={provenance?.source === "transcript" ? "success" : "neutral"}>
          {provenance?.source === "transcript"
            ? "From transcript"
            : provenance?.source === "contractor"
              ? "Contractor"
              : "Provenance unknown"}
        </Badge>
      </div>
      {provenance?.transcript_span ? (
        <p className="text-xs italic text-text-secondary">“{provenance.transcript_span}”</p>
      ) : null}
    </li>
  );
};

const LineList = ({ items, empty }: { items: LineItem[]; empty: string }) =>
  items.length === 0 ? (
    <Empty>{empty}</Empty>
  ) : (
    <ul className="flex flex-col">
      {items.map((item, index) => (
        <LineRow key={`${item.description}-${index}`} item={item} />
      ))}
    </ul>
  );

export default async function RunViewerPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, created_at, transcript, conversation_json, sow_json, extracted_json")
    .eq("id", id)
    .maybeSingle();

  // A rejected query is not a missing job — without this, a select naming a
  // column production does not have 404s a run that exists.
  await throwIfQueryFailed(jobError, "Loading the run");
  if (!job) notFound();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, total, line_items_json, drafted_line_items_json, contractor_flags_json")
    .eq("job_id", id)
    .maybeSingle();

  await throwIfQueryFailed(quoteError, "Loading the run");

  // Reports filed against this run through the control at the foot of the page.
  // Same run_id the voice funnel events carry, which is the job id — so a
  // tester's report opens here, next to the stages that produced it.
  //
  // Read through the service role, and this is the one place on the page that
  // is: `events` carries an INSERT policy and no SELECT policy at all (see
  // migration 19/34), so an RLS-scoped read returns an empty list forever
  // rather than an error — a pane that silently always says "no reports" is
  // worse than no pane. The alternative was a new SELECT policy, which is a
  // permissions change to a table every surface writes to, applied by hand
  // ahead of this deploy; not worth it for a read that is already narrower
  // than the policy would be.
  //
  // The scoping is what makes it safe, and it is strictly tighter than the
  // page around it: the `jobs` select above proved through RLS that this
  // caller owns this job — a row belonging to another tenant has already
  // 404'd by now — and this reads only rows whose run_id IS that job and whose
  // event_name is this one report type. No id from the request reaches the
  // query except the one RLS just authorised.
  const { data: reports } = await createAdminClient()
    .from("events")
    .select("event_name, properties, created_at")
    .eq("event_name", "run_problem_reported")
    .contains("properties", { run_id: job.id })
    .order("created_at", { ascending: false });

  const turns = (job.conversation_json ?? []) as TranscriptTurn[];
  const sow = job.sow_json as SowState | null;
  const extracted = job.extracted_json as Record<string, unknown> | null;
  const drafted = (quote?.drafted_line_items_json ?? []) as LineItem[];
  const active = (quote?.line_items_json ?? []) as LineItem[];
  const flags = (quote?.contractor_flags_json ?? []) as string[];

  const comparison = compareRun(drafted, active);
  const traces = traceStatedPrices(sow?.stated_prices, drafted, active);

  return (
    <>
      <PageHeader backHref={`/jobs/${id}`} backLabel="Back to job" title="How this quote was built" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-6">
        <p className="text-sm text-text-secondary">
          Every stage this job passed through, in order. Job <code>{job.id}</code> · status{" "}
          {job.status}.
        </p>

        <Pane
          step={1}
          title="Conversation"
          subtitle="Who said what, as the call happened."
        >
          {turns.length === 0 ? (
            <Empty>
              No speaker-labelled turns were recorded. Jobs typed in by hand, and calls from before
              turns were kept, have none.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {turns.map((turn, index) => (
                <li key={index} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                    {turn.speaker === "contractor" ? "You" : "Motko"}
                  </span>
                  <span>{turn.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Pane>

        <Pane
          step={2}
          title="Transcript"
          subtitle="The flat text the drafter was given."
        >
          {job.transcript ? (
            <p className="whitespace-pre-wrap">{job.transcript}</p>
          ) : (
            <Empty>No transcript was stored for this job.</Empty>
          )}
        </Pane>

        <Pane
          step={3}
          title="Scope of work"
          subtitle="What the call was understood to have captured — and where every price you spoke ended up."
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Prices you said out loud
            </h3>
            {traces.length === 0 ? (
              <Empty>No spoken prices were picked up in this call.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {traces.map((trace, index) => (
                  <li key={index} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">{formatGBP(trace.amount)}</span>
                      <span className="text-text-secondary">{trace.item ?? "no item stated"}</span>
                      <Badge tone={traceTone(trace.stage)}>{traceLabel(trace.stage)}</Badge>
                    </div>
                    <p className="text-xs text-text-secondary">{trace.reason}</p>
                    <p className="text-xs italic text-text-secondary">“{trace.span}”</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Work captured, room by room
            </h3>
            {/* The thin-scope check. A room with no work items next to a
                transcript that clearly described some is the single most
                legible drafting failure there is, and it was previously only
                visible by reading sow_json. */}
            {(sow?.rooms ?? []).length === 0 ? (
              <Empty>No rooms were captured.</Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {(sow?.rooms ?? []).map((room, index) => (
                  <li key={index} className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {room.name}
                      {room.dimensions ? ` · ${room.dimensions}` : ""}
                    </span>
                    {room.work_items.length === 0 ? (
                      <span className="text-xs text-error">
                        Nothing captured for this room.
                      </span>
                    ) : (
                      <ul className="list-disc pl-5 text-sm">
                        {room.work_items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              How it was priced
            </h3>
            <p>
              {sow?.pricing
                ? `${sow.pricing.mode}${
                    sow.pricing.fixed_amount != null
                      ? ` at ${formatGBP(sow.pricing.fixed_amount)}`
                      : ""
                  }`
                : "The pricing-mode question never landed."}
            </p>
            {sow?.wrap_incomplete ? (
              <p className="text-sm text-error">
                The call ended without asking: {(sow.unasked_required ?? []).join(", ")}.
              </p>
            ) : null}
          </div>
        </Pane>

        <Pane
          step={4}
          title="Extraction"
          subtitle="The structured job the drafter was handed."
        >
          {extracted ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(extracted, null, 2)}
            </pre>
          ) : (
            <Empty>Nothing was extracted for this job.</Empty>
          )}
        </Pane>

        <Pane
          step={5}
          title="Drafted lines"
          subtitle="The full calculated breakdown, before the pricing mode was applied."
        >
          <LineList items={drafted} empty="This quote has no stored draft — it was typed by hand." />
        </Pane>

        <Pane
          step={6}
          title="Final lines"
          subtitle="What the quote carries now."
        >
          <LineList items={active} empty="This job has no quote yet." />

          {/* The comparison, and the reason it names a collapse rather than
              counting deletions: applyPricingMode collapses a fixed-mode quote
              to one works line with no human involved, so a subtraction here
              reports edits nobody made. See src/lib/run-view.ts. */}
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Draft versus final
            </h3>
            {comparison.kind === "no-draft" ? (
              <p>Nothing to compare — there is no stored draft for this quote.</p>
            ) : comparison.kind === "identical" ? (
              <p>Unchanged: all {comparison.count} drafted lines are on the quote as drafted.</p>
            ) : comparison.kind === "collapsed" ? (
              <p>
                Collapsed to a single works line by fixed-mode pricing. The {comparison.draftedCount}{" "}
                drafted lines above are still stored and still add up — this is not{" "}
                {comparison.draftedCount - 1} deletions.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p>
                  Edited: {comparison.draftedCount} drafted, {comparison.activeCount} final.
                </p>
                {comparison.removed.length > 0 ? (
                  <p className="text-sm">Removed: {comparison.removed.join("; ")}</p>
                ) : null}
                {comparison.added.length > 0 ? (
                  <p className="text-sm">Added: {comparison.added.join("; ")}</p>
                ) : null}
              </div>
            )}
          </div>

          {flags.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-line pt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                Flags raised on this quote
              </h3>
              <ul className="list-disc pl-5">
                {flags.map((flag, index) => (
                  <li key={index}>{flag}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Pane>

        {reports && reports.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Reported problems</h2>
            <Card className="flex flex-col gap-3 text-sm">
              <ul className="flex flex-col gap-2">
                {reports.map((report, index) => {
                  const properties = (report.properties ?? {}) as Record<string, unknown>;
                  return (
                    <li key={index} className="flex flex-col gap-0.5">
                      <span className="text-xs text-text-secondary">
                        {report.created_at} · {String(properties.route ?? "unknown route")}
                      </span>
                      <span>{String(properties.note ?? "")}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ) : null}

        <ReportRunProblem runId={id} />

        <InlineLink href={`/jobs/${id}`} className="self-start">
          Back to the job
        </InlineLink>
      </main>
    </>
  );
}
