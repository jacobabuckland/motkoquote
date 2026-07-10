import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { QuoteEditor } from "./quote-editor";

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
      "id, transcript, extracted_json, status, contractor:contractors(vat_registered)",
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

  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="w-full max-w-xl flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold mb-1">
            {extraction?.job_type ?? "Job"}
          </h1>
          <p className="text-sm text-neutral-500">Status: {job.status}</p>
        </div>

        {extraction?.scope_items && extraction.scope_items.length > 0 && (
          <section>
            <h2 className="font-medium mb-2">Scope</h2>
            <ul className="list-disc list-inside text-sm text-neutral-700">
              {extraction.scope_items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        {job.transcript && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Transcript</summary>
            <p className="mt-2 text-neutral-600 whitespace-pre-wrap">
              {job.transcript}
            </p>
          </details>
        )}

        {quote ? (
          <QuoteEditor
            jobId={job.id}
            quoteId={quote.id}
            initialLineItems={quote.line_items_json as never}
            vatRegistered={contractor?.vat_registered ?? false}
          />
        ) : (
          <p className="text-sm text-neutral-500">
            Draft quote is still being generated. Refresh in a moment.
          </p>
        )}
      </div>
    </main>
  );
}
