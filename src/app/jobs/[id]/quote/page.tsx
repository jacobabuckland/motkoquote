import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { QuoteEditor } from "../quote-editor";
import { throwIfQueryFailed } from "@/lib/query-error";
import { resolvePricingMode, sowStateSchema } from "@/lib/schemas/sow";

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // OWNERSHIP IS SCOPED ON THE READ, exactly as /jobs/[id] does it.
  //
  // This route is reachable by id, so without the contractor predicate below
  // any signed-in contractor could open /jobs/<someone-else's-id>/quote and
  // both read and re-price a stranger's quote — the editor's server actions
  // take the ids this page hands them. Authenticating the user is not the same
  // as authorising the row, and the job page has always done both.
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id, vat_registered")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  await throwIfQueryFailed(contractorError, "Loading your profile");
  if (!contractor) notFound();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, transcript, sow_json, customer:customers(name, contact)")
    .eq("id", id)
    .eq("contractor_id", contractor.id)
    .maybeSingle();

  await throwIfQueryFailed(jobError, "Loading the job");
  if (!job) notFound();

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      // total/subtotal/vat_amount are migration 80's recorded split. The
      // editor is the fifth surface that must read it rather than recompute
      // from today's registration flag — without them the job page and the
      // editor show two different totals for one quote.
      "id, line_items_json, contractor_flags_json, status, sent_total, total, subtotal, vat_amount, deposit_pennies",
    )
    .eq("job_id", id)
    .maybeSingle();

  await throwIfQueryFailed(quoteError, "Loading the quote for this job");
  if (!quote) notFound();

  const customer = job.customer as unknown as {
    name: string;
    contact?: { email?: string; phone?: string; address?: string } | null;
  } | null;

  const sow = job.sow_json ? sowStateSchema.parse(job.sow_json) : null;

  const jobTitle = customer?.name ?? sow?.customer_name ?? "Untitled quote";

  return (
    <div className="flex flex-1 flex-col">
      {/* THE WAY OUT. There is no layout above this route — nothing under
          /jobs/[id] renders a shell — so a contractor who opened the editor
          from the job page had the browser's own back gesture and nothing
          else, and inside the Capacitor shell there isn't one.
          Reported 20 Sep.

          Its two siblings already do exactly this: /jobs/[id]/sow and
          /jobs/[id]/run both render PageHeader with the same href and the same
          label. This route was the one that was missed.

          No `title` — the editor prints the quote's name directly beneath,
          large, and a second copy of it in the bar would be the "one fact told
          twice" that the status panel exists to undo. */}
      <PageHeader backHref={`/jobs/${id}`} backLabel="Back to job" />
      <div className="mx-auto w-full max-w-3xl p-4">
        <QuoteEditor
          jobId={job.id}
          quoteId={quote.id}
          jobTitle={jobTitle}
          initialLineItems={quote.line_items_json as never}
          quoteStatus={quote.status}
          sentTotal={quote.sent_total ?? null}
          contractorFlags={(quote.contractor_flags_json as string[] | null) ?? []}
          vatRegistered={contractor.vat_registered ?? false}
          initialDepositPennies={(quote.deposit_pennies as number | null) ?? null}
          recordedQuote={{
            total: quote.total ?? 0,
            subtotal: (quote.subtotal as number | null) ?? null,
            vat_amount: (quote.vat_amount as number | null) ?? null,
          }}
          draftExpected={Boolean(job.sow_json || job.transcript)}
          initialPricingMode={resolvePricingMode(sow ?? { pricing: null }) ?? undefined}
          initialFixedAmount={sow?.pricing?.fixed_amount ?? null}
          // THE CUSTOMER ROW FIRST, the SoW only as a fallback — the same rule
          // the job page applies. sow_json is what the VOICE call captured;
          // once a quote has been sent, `customers` holds what the contractor
          // actually confirmed at send time, and nothing writes it back.
          initialCustomerName={customer?.name || sow?.customer_name || undefined}
          initialCustomerEmail={customer?.contact?.email || sow?.customer_email || undefined}
          initialCustomerPhone={customer?.contact?.phone || sow?.customer_phone || undefined}
          transcript={job.transcript}
          initialSiteAddress={customer?.contact?.address || sow?.site_address || undefined}
        />
      </div>
    </div>
  );
}
