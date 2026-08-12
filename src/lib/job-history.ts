// Pure, deterministic helpers behind the /jobs history ("My work") page. The
// page fetches every job for the signed-in trade with its quote, contract and
// invoices, then this module derives a single normalized row per job (reusing
// deriveJobState — the one source of pipeline truth), buckets it for the
// filter chips, and computes the totals band. Kept pure and node-testable: no
// React, no Supabase, no I/O.

import { createElement, type ReactNode } from "react";
import Link from "next/link";
import type { StatusLabel } from "@/components/ui/status-chip";
import {
  deriveJobState,
  type QuoteState,
  type ContractState,
  type InvoiceState,
} from "@/lib/job-stages";
import { buttonClass } from "@/components/ui/button";

// The four buckets a job can fall into, plus "all". These are the filter chips;
// every job belongs to exactly one bucket. "Declined/expired" collapses both
// terminal rejections. Archived is first-class here — this is the only surface
// that shows archived jobs.
export type JobBucket = "in_progress" | "completed" | "declined" | "archived";
export type JobHistoryFilter = "all" | JobBucket;

export const JOB_HISTORY_FILTERS: { key: JobHistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "declined", label: "Declined/expired" },
  { key: "archived", label: "Archived" },
];

const FILTER_KEYS = new Set<string>(JOB_HISTORY_FILTERS.map((f) => f.key));

// Narrow an untrusted ?filter= search param to a known bucket, defaulting to
// "all" so a hand-typed URL can never render an undefined view.
export const parseJobFilter = (raw: string | undefined): JobHistoryFilter =>
  raw && FILTER_KEYS.has(raw) ? (raw as JobHistoryFilter) : "all";

// The raw shape the page's Supabase select returns for each job. Mirrors the
// job → quote → contracts/invoices nesting used on the job detail page.
export type RawHistoryJob = {
  id: string;
  created_at: string;
  extracted_json: { job_type?: string } | null;
  customer: { name: string } | null;
  quote: {
    total: number;
    status: string;
    sent_at: string | null;
    viewed_at: string | null;
    accepted_at: string | null;
    declined_at: string | null;
    created_at: string;
    contracts: ContractState[];
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
};

const paidInvoiceOf = (invoices: InvoiceState[]): InvoiceState | null =>
  invoices.find((i) => i.status === "paid" || i.paid_at !== null) ?? null;

// Normalize one raw job into its history row. Archived quotes short-circuit the
// pipeline derivation (an archived quote isn't a live pipeline state), and a
// job with no quote yet is an in-progress draft.
export const normalizeHistoryJob = (
  raw: RawHistoryJob,
  now = Date.now(),
): HistoryJob => {
  const customerName = raw.customer?.name ?? "Untitled job";
  const title = raw.extracted_json?.job_type ?? "Job";
  const quote = raw.quote;

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
    };
  }

  const quoteState: QuoteState = {
    status: quote.status,
    sent_at: quote.sent_at,
    viewed_at: quote.viewed_at,
    accepted_at: quote.accepted_at,
    declined_at: quote.declined_at,
  };
  const contractState: ContractState = quote.contracts?.[0] ?? null;
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
  };
};

export const filterJobs = (
  jobs: HistoryJob[],
  filter: JobHistoryFilter,
): HistoryJob[] =>
  filter === "all" ? jobs : jobs.filter((j) => j.bucket === filter);

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

export const JOBS_PER_PAGE = 25;

// Per-filter copy for the empty state.
export const EMPTY_COPY: Record<
  JobHistoryFilter,
  { title: string; description: string }
> = {
  all: {
    title: "No jobs yet",
    description: "Quotes you send will show up here to track from start to paid.",
  },
  in_progress: {
    title: "Nothing in progress",
    description: "Live jobs — sent, accepted, awaiting payment — will appear here.",
  },
  completed: {
    title: "No completed jobs yet",
    description: "Jobs you've been paid for will be collected here.",
  },
  declined: {
    title: "Nothing declined or expired",
    description: "Quotes and contracts a customer turned down will land here.",
  },
  archived: {
    title: "Nothing archived",
    description: "Jobs you archive from the dashboard will be kept here.",
  },
};

// Build props for EmptyState based on the current filter and whether any jobs
// exist. When the trade has zero jobs total, include a primary action button
// linking to the new quote form. When jobs exist but are filtered out, omit
// the action.
export const buildEmptyStateProps = ({
  filter,
  hasAnyJobs,
}: {
  filter: JobHistoryFilter;
  hasAnyJobs: boolean;
}): {
  title: string;
  description: string;
  action?: ReactNode;
} => {
  const copy = EMPTY_COPY[filter];
  const action = hasAnyJobs
    ? undefined
    : createElement(
        Link,
        { href: "/jobs/new", className: buttonClass("primary") },
        "Create your first quote",
      );

  return {
    title: copy.title,
    description: copy.description,
    action,
  };
};
