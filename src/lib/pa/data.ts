// Contractor-scoped reads for the PA tools.
//
// Every query names `contractor_id` (jobs, customers, assumptions) or goes
// through a job id that has just been read under that filter. RLS already
// scopes these to the signed-in contractor; the explicit filter is the second
// lock, so a bug in one layer is not a cross-contractor read.
//
// Queries are deliberately flat (no PostgREST embeds): they stay readable, and
// the tests can run them against an in-memory table fake that really filters.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineItem } from "@/lib/schemas/job";
import { sowStateSchema, type SowState } from "@/lib/schemas/sow";
import type {
  ContractState,
  InvoiceState,
  PaymentStageState,
  QuoteState,
} from "@/lib/job-stages";

export type JobRow = {
  id: string;
  contractor_id: string;
  status: string;
  sow_json: unknown;
  extracted_json: { job_type?: string } | null;
  customer_id: string | null;
  work_completed_at: string | null;
  archived_at: string | null;
  created_at: string;
};

export type QuoteRow = {
  id: string;
  job_id: string;
  status: string;
  line_items_json: unknown;
  total: number | null;
  deposit_pennies: number | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
};

export type CustomerRow = {
  id: string;
  name: string;
  contact: { email?: string; phone?: string; address?: string; sms_opt_out?: boolean } | null;
};

export type ContractRow = {
  id: string;
  quote_id: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  withdrawn_at: string | null;
  deposit_pct: number | null;
};

export type InvoiceRow = InvoiceState & { quote_id: string; amount: number };

export type JobBundle = {
  job: JobRow;
  sow: SowState | null;
  quote: QuoteRow | null;
  customer: CustomerRow | null;
  contract: ContractState;
  invoices: InvoiceRow[];
  stages: PaymentStageState[];
};

const JOB_COLUMNS =
  "id, contractor_id, status, sow_json, extracted_json, customer_id, work_completed_at, archived_at, created_at";
const QUOTE_COLUMNS =
  "id, job_id, status, line_items_json, total, deposit_pennies, sent_at, viewed_at, accepted_at, declined_at";
const CONTRACT_COLUMNS =
  "id, quote_id, status, sent_at, signed_at, declined_at, withdrawn_at, deposit_pct";
const INVOICE_COLUMNS =
  "id, quote_id, status, invoice_type, due_date, created_at, paid_at, amount";

export const parseSow = (raw: unknown): SowState | null => {
  if (!raw) return null;
  const parsed = sowStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const lineItemsOf = (quote: QuoteRow | null): LineItem[] =>
  Array.isArray(quote?.line_items_json) ? (quote!.line_items_json as LineItem[]) : [];

export const quoteStateOf = (quote: QuoteRow | null): QuoteState =>
  quote
    ? {
        status: quote.status,
        sent_at: quote.sent_at,
        viewed_at: quote.viewed_at,
        accepted_at: quote.accepted_at,
        declined_at: quote.declined_at,
        total: quote.total,
        deposit_pennies: quote.deposit_pennies,
      }
    : null;

// Everything about one job, for one contractor. Null when the job does not
// exist OR is not theirs — callers cannot tell the two apart, by design.
export const loadJobBundle = async (
  db: SupabaseClient,
  contractorId: string,
  jobId: string,
): Promise<JobBundle | null> => {
  const { data: job } = await db
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("contractor_id", contractorId)
    .maybeSingle();
  if (!job) return null;
  const jobRow = job as unknown as JobRow;

  const { data: quote } = await db
    .from("quotes")
    .select(QUOTE_COLUMNS)
    .eq("job_id", jobRow.id)
    .maybeSingle();
  const quoteRow = (quote as unknown as QuoteRow | null) ?? null;

  let customer: CustomerRow | null = null;
  if (jobRow.customer_id) {
    const { data } = await db
      .from("customers")
      .select("id, name, contact")
      .eq("id", jobRow.customer_id)
      .eq("contractor_id", contractorId)
      .maybeSingle();
    customer = (data as unknown as CustomerRow | null) ?? null;
  }

  let contract: ContractState = null;
  let invoices: InvoiceRow[] = [];
  if (quoteRow) {
    const { data: contractData } = await db
      .from("contracts")
      .select(CONTRACT_COLUMNS)
      .eq("quote_id", quoteRow.id)
      .maybeSingle();
    contract = (contractData as unknown as ContractRow | null) ?? null;

    const { data: invoiceData } = await db
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("quote_id", quoteRow.id);
    invoices = (invoiceData as unknown as InvoiceRow[] | null) ?? [];
  }

  const { data: stageData } = await db
    .from("payment_stages")
    .select("stage_number, settled_at")
    .eq("job_id", jobRow.id);

  return {
    job: jobRow,
    sow: parseSow(jobRow.sow_json),
    quote: quoteRow,
    customer,
    contract,
    invoices,
    stages: (stageData as unknown as PaymentStageState[] | null) ?? [],
  };
};

// The recent, live jobs for one contractor, with everything the stage logic
// needs, in six flat queries rather than one per job.
export const loadJobBundles = async (
  db: SupabaseClient,
  contractorId: string,
  limit = 40,
): Promise<JobBundle[]> => {
  const { data: jobData } = await db
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("contractor_id", contractorId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  const jobs = (jobData as unknown as JobRow[] | null) ?? [];
  if (jobs.length === 0) return [];

  const jobIds = jobs.map((job) => job.id);
  const customerIds = jobs.map((job) => job.customer_id).filter((id): id is string => Boolean(id));

  const { data: quoteData } = await db.from("quotes").select(QUOTE_COLUMNS).in("job_id", jobIds);
  const quotes = (quoteData as unknown as QuoteRow[] | null) ?? [];
  const quoteIds = quotes.map((quote) => quote.id);

  const [customers, contracts, invoices, stages] = await Promise.all([
    customerIds.length
      ? db
          .from("customers")
          .select("id, name, contact")
          .eq("contractor_id", contractorId)
          .in("id", customerIds)
      : Promise.resolve({ data: [] }),
    quoteIds.length
      ? db.from("contracts").select(CONTRACT_COLUMNS).in("quote_id", quoteIds)
      : Promise.resolve({ data: [] }),
    quoteIds.length
      ? db.from("invoices").select(INVOICE_COLUMNS).in("quote_id", quoteIds)
      : Promise.resolve({ data: [] }),
    db.from("payment_stages").select("job_id, stage_number, settled_at").in("job_id", jobIds),
  ]);

  const customerRows = (customers.data as unknown as CustomerRow[] | null) ?? [];
  const contractRows = (contracts.data as unknown as ContractRow[] | null) ?? [];
  const invoiceRows = (invoices.data as unknown as InvoiceRow[] | null) ?? [];
  const stageRows =
    (stages.data as unknown as (PaymentStageState & { job_id: string })[] | null) ?? [];

  return jobs.map((job) => {
    const quote = quotes.find((candidate) => candidate.job_id === job.id) ?? null;
    return {
      job,
      sow: parseSow(job.sow_json),
      quote,
      customer: customerRows.find((customer) => customer.id === job.customer_id) ?? null,
      contract: quote ? (contractRows.find((c) => c.quote_id === quote.id) ?? null) : null,
      invoices: quote ? invoiceRows.filter((invoice) => invoice.quote_id === quote.id) : [],
      stages: stageRows.filter((stage) => stage.job_id === job.id),
    };
  });
};

// Customer-supplied text is data, not instructions. Before it goes anywhere
// near a model: strip control characters and angle brackets, collapse
// whitespace, cap the length. This does not make injection impossible — the
// structural defences do that — it just stops a name field being a novel.
export const sanitiseForModel = (value: string | null | undefined, max = 80): string => {
  if (!value) return "";
  return value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
};
