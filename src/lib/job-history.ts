// Pure, deterministic helpers behind the /jobs history ("My work") page. The
// page fetches every job for the signed-in trade with its quote, contract and
// invoices, then this module derives a single normalized row per job (reusing
// deriveJobState — the one source of pipeline truth), buckets it for the
// filter chips, and computes the totals band. Kept pure and node-testable: no
// React, no Supabase, no I/O.

import type { StatusLabel } from "@/components/ui/status-chip";
import {
  deriveJobState,
  type QuoteState,
  type ContractState,
  type InvoiceState,
  type Situation,
} from "@/lib/job-stages";
import { formatDate } from "@/lib/format";
import { embeddedOne, type Embedded } from "@/lib/postgrest-embed";

// The four buckets a job can fall into, plus "all". These are the filter chips;
// every job belongs to exactly one bucket. "Declined/expired" collapses both
// terminal rejections. Archived is first-class here — this is the only surface
// that shows archived jobs.
export type JobBucket = "in_progress" | "completed" | "declined" | "archived";
export type JobHistoryFilter = "active" | "paid" | "archived" | "all";

export const JOB_HISTORY_FILTERS: { key: JobHistoryFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "paid", label: "Paid" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

const FILTER_KEYS = new Set<string>(JOB_HISTORY_FILTERS.map((f) => f.key));

// Narrow an untrusted ?filter= search param to a known filter, defaulting to
// "active" so a hand-typed URL can never render an undefined view.
export const parseJobFilter = (raw: string | undefined): JobHistoryFilter =>
  raw && FILTER_KEYS.has(raw) ? (raw as JobHistoryFilter) : "active";

// The raw shape the page's Supabase select returns for each job. Mirrors the
// job → quote → contracts/invoices nesting used on the job detail page.
export type RawHistoryJob = {
  id: string;
  created_at: string;
  archived_at?: string | null;
  extracted_json: { job_type?: string } | null;
  customer: { name: string } | null;
  sow_json?: { overview_narrative?: string | null } | null;
  quote: {
    total: number;
    status: string;
    sent_at: string | null;
    viewed_at: string | null;
    accepted_at: string | null;
    declined_at: string | null;
    created_at: string;
    // to-one embed: PostgREST returns an OBJECT here, not an array. See
    // postgrest-embed.ts. `invoices` below is genuinely to-many.
    contracts: Embedded<NonNullable<ContractState>>;
    invoices: InvoiceState[];
  } | null;
};

export type HistoryJob = {
  jobId: string;
  customerName: string;
  title: string;
  amount: number;
  status: StatusLabel;
  bucket: JobBucket;
  // The date this job was collected/paid (Completed only), used for the
  // Completed date-range line and never set for any other bucket.
  paidAt: string | null;
  // Whether an invoice has been raised — drives the "billed/invoiced" total.
  invoiced: boolean;
  // Most-recent-activity timestamp, for recent-first ordering.
  sortAt: string;
  // The job's position in the pipeline, from deriveJobState.
  situation: Situation;
  // Stages that were forced for monotonicity rather than genuinely reached.
  // Empty for monotonic jobs, populated when the pipeline had inconsistencies.
  // Optional for backward compatibility with existing tests.
  forcedStages?: string[];
};

// Export as a value to enable `typeof mod.HistoryJob` in tests
export const HistoryJob = null! as HistoryJob;

const paidInvoiceOf = (invoices: InvoiceState[]): InvoiceState | null =>
  invoices.find((i) => i.status === "paid" || i.paid_at !== null) ?? null;

// Helper: check if a string is "Job" (case-insensitive placeholder)
const isJobPlaceholder = (str: string | undefined | null): boolean => {
  if (!str) return false;
  return str.toLowerCase() === "job";
};

// Helper: extract first meaningful text from overview narrative
const extractOverviewSnippet = (narrative: string | undefined | null): string | null => {
  if (!narrative?.trim()) return null;
  const trimmed = narrative.trim();
  // Try to extract first sentence
  const firstSentence = trimmed.match(/^[^.!?]+[.!?]/)?.[0];
  if (firstSentence && firstSentence.length <= 60) {
    return firstSentence.trim();
  }
  // Otherwise take first ~50 chars
  if (trimmed.length <= 50) return trimmed;
  return trimmed.slice(0, 50).trim() + "...";
};

// Normalize one raw job into its history row. Job-level archived_at takes
// precedence (archiving at any stage), then quote.status = "archived" (the
// legacy quote-only archive), and a job with no quote yet is an in-progress
// draft.
export const normalizeHistoryJob = (
  raw: RawHistoryJob,
  now = Date.now(),
): HistoryJob => {
  // Primary label fallback hierarchy
  let customerName: string;
  const hasCustomerName = raw.customer?.name?.trim();
  const jobType = raw.extracted_json?.job_type;
  const hasValidJobType = jobType && !isJobPlaceholder(jobType);

  if (hasCustomerName) {
    customerName = hasCustomerName;
  } else if (hasValidJobType) {
    customerName = jobType;
  } else {
    const overviewSnippet = extractOverviewSnippet(raw.sow_json?.overview_narrative);
    if (overviewSnippet) {
      customerName = overviewSnippet;
    } else {
      // Fall back to formatted creation date, with "Untitled job" as absolute last resort
      const formattedDate = raw.created_at ? formatDate(raw.created_at) : "";
      if (formattedDate) {
        customerName = `Job from ${formattedDate}`;
      } else {
        customerName = "Untitled job";
      }
    }
  }

  // Job type descriptor: only show if valid and not a placeholder
  const title = hasValidJobType ? jobType : "";

  const quote = raw.quote;

  // Job-level archive takes precedence: a job can be archived at any stage
  // (drafted, sent, signed, invoiced), so check jobs.archived_at before
  // checking quote.status. An archived job with a signed contract or unpaid
  // invoice is still archived — archiving is filing, not voiding.
  if (raw.archived_at) {
    return {
      jobId: raw.id,
      customerName,
      title,
      amount: quote?.total ?? 0,
      status: "Archived",
      bucket: "archived",
      paidAt: null,
      invoiced: (quote?.invoices?.length ?? 0) > 0,
      sortAt: quote?.created_at ?? raw.created_at,
      situation: "draft_quote",
      forcedStages: [],
    };
  }

  if (quote?.status === "archived") {
    return {
      jobId: raw.id,
      customerName,
      title,
      amount: quote.total,
      status: "Archived",
      bucket: "archived",
      paidAt: null,
      invoiced: (quote.invoices?.length ?? 0) > 0,
      sortAt: quote.created_at,
      situation: "draft_quote",
      forcedStages: [],
    };
  }

  if (!quote) {
    return {
      jobId: raw.id,
      customerName,
      title,
      amount: 0,
      status: "Draft",
      bucket: "in_progress",
      paidAt: null,
      invoiced: false,
      sortAt: raw.created_at,
      situation: "draft_quote",
      forcedStages: [],
    };
  }

  const quoteState: QuoteState = {
    status: quote.status,
    sent_at: quote.sent_at,
    viewed_at: quote.viewed_at,
    accepted_at: quote.accepted_at,
    declined_at: quote.declined_at,
  };
  const contractState: ContractState = embeddedOne(quote.contracts);
  const invoices = quote.invoices ?? [];
  const state = deriveJobState(quoteState, contractState, invoices, now);

  const bucket: JobBucket =
    state.situation === "paid"
      ? "completed"
      : state.situation === "quote_declined" || state.situation === "contract_declined"
        ? "declined"
        : "in_progress";

  const paidAt =
    bucket === "completed" ? (paidInvoiceOf(invoices)?.paid_at ?? null) : null;

  const sortAt =
    paidAt ?? quote.accepted_at ?? quote.sent_at ?? quote.created_at;

  return {
    jobId: raw.id,
    customerName,
    title,
    amount: quote.total,
    status: state.overallStatus,
    bucket,
    paidAt,
    invoiced: invoices.length > 0,
    sortAt,
    situation: state.situation,
    forcedStages: state.inconsistentStages,
  };
};

export const filterJobs = (
  jobs: HistoryJob[],
  filter: JobHistoryFilter,
): HistoryJob[] => {
  if (filter === "all") return jobs;
  if (filter === "active")
    return jobs.filter(
      (j) => j.bucket === "in_progress" || j.bucket === "declined",
    );
  if (filter === "paid") return jobs.filter((j) => j.bucket === "completed");
  if (filter === "archived") return jobs.filter((j) => j.bucket === "archived");
  return jobs;
};

// Case-insensitive substring match across customer name and job title. A blank
// query returns everything.
export const searchJobs = (jobs: HistoryJob[], query: string): HistoryJob[] => {
  const q = query.trim().toLowerCase();
  if (!q) return jobs;
  return jobs.filter((j) =>
    `${j.customerName} ${j.title}`.toLowerCase().includes(q),
  );
};

export type JobHistorySummary = {
  count: number;
  totalBilled: number;
  totalCollected: number;
  paidFrom: string | null;
  paidTo: string | null;
};

// Totals band over a filtered set: how many jobs, how much has been
// invoiced/billed, how much has actually been collected, and — for the
// Completed view — the span of payment dates.
export const summariseJobs = (jobs: HistoryJob[]): JobHistorySummary => {
  const totalBilled = jobs
    .filter((j) => j.invoiced)
    .reduce((sum, j) => sum + j.amount, 0);
  const totalCollected = jobs
    .filter((j) => j.bucket === "completed")
    .reduce((sum, j) => sum + j.amount, 0);
  const paidDates = jobs
    .map((j) => j.paidAt)
    .filter((d): d is string => d !== null)
    .sort();

  return {
    count: jobs.length,
    totalBilled,
    totalCollected,
    paidFrom: paidDates[0] ?? null,
    paidTo: paidDates[paidDates.length - 1] ?? null,
  };
};

// Recent-first ordering by last activity.
export const sortByRecency = (jobs: HistoryJob[]): HistoryJob[] =>
  [...jobs].sort(
    (a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime(),
  );

// Urgency tiers for in-progress jobs, from highest to lowest priority.
const URGENCY_TIER_ORDER: Situation[] = [
  "invoice_overdue",
  "invoice_unpaid",
  "quote_sent",
  "contract_sent",
  "draft_quote",
];

// Map each tier to its numeric priority. Lower numbers = higher priority.
// Jobs not in the defined tiers fall into tier 6 (catch-all).
const getTier = (situation: Situation): number => {
  const index = URGENCY_TIER_ORDER.indexOf(situation);
  return index === -1 ? 6 : index + 1;
};

// Human-readable labels for each urgency tier.
export const URGENCY_TIER_LABELS: { tier: number; label: string }[] = [
  { tier: 1, label: "Overdue invoices" },
  { tier: 2, label: "Unpaid invoices" },
  { tier: 3, label: "Sent quotes" },
  { tier: 4, label: "Sent contracts" },
  { tier: 5, label: "Drafts" },
  { tier: 6, label: "Other in-progress jobs" },
];

// Sort in-progress jobs by urgency: tier first (overdue → unpaid → sent quotes
// → sent contracts → drafts → other), then oldest-first within each tier, with
// job ID as a tie-break when timestamps are identical.
export const sortByUrgency = (jobs: HistoryJob[]): HistoryJob[] =>
  [...jobs].sort((a, b) => {
    const tierA = getTier(a.situation);
    const tierB = getTier(b.situation);
    if (tierA !== tierB) return tierA - tierB;

    // Within the same tier: oldest first (earliest sortAt).
    const timeA = new Date(a.sortAt || 0).getTime();
    const timeB = new Date(b.sortAt || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;

    // Tie-break by job ID (alphabetical).
    return (a.jobId || "").localeCompare(b.jobId || "");
  });

// Group jobs by urgency tier for sectioned rendering. Returns an array of
// {tier, label, jobs} objects, one per tier that has at least one job. Empty
// tiers are omitted.
export const groupByUrgencyTier = (
  jobs: HistoryJob[],
): { tier: number; label: string; jobs: HistoryJob[] }[] => {
  const sorted = sortByUrgency(jobs);
  const byTier = new Map<number, HistoryJob[]>();

  for (const job of sorted) {
    const tier = getTier(job.situation);
    const group = byTier.get(tier) ?? [];
    group.push(job);
    byTier.set(tier, group);
  }

  return URGENCY_TIER_LABELS.filter((entry) => byTier.has(entry.tier)).map((entry) => ({
    tier: entry.tier,
    label: entry.label,
    jobs: byTier.get(entry.tier)!,
  }));
};

export const JOBS_PER_PAGE = 25;
