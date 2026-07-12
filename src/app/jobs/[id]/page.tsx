import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuoteEditor } from "./quote-editor";
import type { SowState } from "@/lib/schemas/sow";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { InlineLink } from "@/components/ui/inline-link";

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

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, transcript, extracted_json, sow_json, status, contractor:contractors(vat_registered)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!job) notFound();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, line_items_json, total")
    .eq("job_id", id)
    .maybeSingle();

  const contractor = job.contractor as unknown as { vat_registered: boolean } | null;
  const extraction = job.extracted_json as {
    job_type?: string;
    scope_items?: string[];
    notes?: string;
  } | null;
  const sow = job.sow_json as SowState | null;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/" backLabel="Home" />

      <main className="flex flex-1 justify-center p-6">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold">
              {sow?.job_type ?? extraction?.job_type ?? "New job"}
            </h1>
            <Badge tone={jobStatusTone[job.status] ?? "neutral"}>
              {jobStatusLabel[job.status] ?? job.status}
            </Badge>
          </div>

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
              <QuoteEditor
                jobId={job.id}
                quoteId={quote.id}
                initialLineItems={quote.line_items_json as never}
                vatRegistered={contractor?.vat_registered ?? false}
              />
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
        </div>
      </main>
    </div>
  );
}
