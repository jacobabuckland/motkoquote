import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppHeader } from "@/components/ui/app-header";
import { EmptyState } from "@/components/ui/empty-state";
import { PipelineRow } from "@/components/ui/pipeline-row";
import { buttonClass } from "@/components/ui/button";
import { formatGBP, formatDate, formatRelative } from "@/lib/format";
import {
  normalizeHistoryJob,
  filterJobs,
  searchJobs,
  summariseJobs,
  sortByRecency,
  sortByUrgency,
  groupByUrgencyTier,
  parseJobFilter,
  JOB_HISTORY_FILTERS,
  JOBS_PER_PAGE,
  type RawHistoryJob,
  type JobHistoryFilter,
} from "@/lib/job-history";
import { MoneyPosition } from "./money-position";
import { FilterPersistence } from "./filter-persistence";

// A high cap: the totals band aggregates the whole filtered set, so we must
// read every job for the trade (not a page's worth). This bounds a runaway
// account while comfortably covering a busy trade's real history.
const HISTORY_CAP = 2000;

// Per-filter copy for the empty state.
const EMPTY_COPY: Record<JobHistoryFilter, { title: string; description: string }> = {
  active: {
    title: "Nothing needs you right now",
    description: "Drafts, sent quotes, accepted jobs, and anything awaiting payment will appear here.",
  },
  paid: {
    title: "No completed jobs yet",
    description: "Jobs you've been paid for will be collected here.",
  },
  archived: {
    title: "Nothing archived",
    description: "Jobs you archive from the dashboard will be kept here.",
  },
  all: {
    title: "No jobs yet",
    description: "Quotes you send will show up here to track from start to paid.",
  },
};

const buildHref = (filter: JobHistoryFilter, query: string, show?: number) => {
  const params = new URLSearchParams();
  if (filter !== "active") params.set("filter", filter);
  if (query) params.set("q", query);
  if (show) params.set("show", String(show));
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
};

export default async function JobsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; show?: string }>;
}) {
  const { filter: filterRaw, q: qRaw, show: showRaw } = await searchParams;
  const filter = parseJobFilter(filterRaw);
  const query = (qRaw ?? "").slice(0, 100);
  const show = Math.max(JOBS_PER_PAGE, Number.parseInt(showRaw ?? "", 10) || JOBS_PER_PAGE);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: contractorRaw } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!contractorRaw) redirect("/setup");
  const contractor = contractorRaw as { id: string; company_name: string };

  const { data: rows } = await supabase
    .from("jobs")
    .select(
      "id, created_at, extracted_json, sow_json, customer:customers(name), quotes(total, status, sent_at, viewed_at, accepted_at, declined_at, created_at, contracts(id, status, sent_at, signed_at, deposit_pct), invoices(id, status, invoice_type, due_date, created_at, paid_at))",
    )
    .order("created_at", { ascending: false })
    .limit(HISTORY_CAP);

  type RawRow = Omit<RawHistoryJob, "quote"> & {
    quotes: NonNullable<RawHistoryJob["quote"]>[];
  };
  const raw = (rows ?? []) as unknown as RawRow[];

  // One normalized row per job, then filter → search → sort. Totals are over
  // the full filtered+searched set; pagination only limits what's rendered.
  const allJobs = raw.map(({ quotes, ...rest }) =>
    normalizeHistoryJob({ ...rest, quote: quotes?.[0] ?? null }),
  );
  const filteredAndSearched = searchJobs(filterJobs(allJobs, filter), query);
  const matched =
    filter === "active" ? sortByUrgency(filteredAndSearched) : sortByRecency(filteredAndSearched);
  const summary = summariseJobs(matched);
  const visible = matched.slice(0, show);
  const hasMore = matched.length > visible.length;

  const empty = EMPTY_COPY[filter];

  const emptyActions: Record<JobHistoryFilter, React.ReactNode> = {
    active: (
      <div className="flex flex-wrap gap-2">
        <Link href="/jobs/new" className={buttonClass("primary")}>
          Start new job
        </Link>
        <Link href="/jobs?filter=paid" className={buttonClass("secondary")}>
          View paid jobs
        </Link>
      </div>
    ),
    paid: (
      <Link href="/jobs?filter=all" className={buttonClass("secondary")}>
        View all jobs
      </Link>
    ),
    archived: (
      <Link href="/jobs?filter=all" className={buttonClass("secondary")}>
        View all jobs
      </Link>
    ),
    all: null,
  };

  return (
    <div className="flex flex-1 flex-col">
      <FilterPersistence currentFilter={filter} />
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">My work</h1>
          <Link href="/jobs/new" className={buttonClass("primary")}>
            New quote
          </Link>
        </div>

        {/* Money position panel */}
        <MoneyPosition />

        {/* Voice ledger query */}
        <Link
          href="/ledger/query"
          className={`${buttonClass("secondary")} flex items-center justify-center gap-2`}
        >
          <span aria-hidden="true">🎤</span>
          Ask about money
        </Link>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {JOB_HISTORY_FILTERS.map(({ key, label }) => {
            const active = key === filter;
            return (
              <Link
                key={key}
                href={buildHref(key, query)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-sm ${
                  active
                    ? "border-primary bg-primary-light font-medium text-primary"
                    : "border-border bg-surface text-secondary-text hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Search */}
        <form action="/jobs" method="get" className="flex gap-2">
          {filter !== "active" && <input type="hidden" name="filter" value={filter} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search by customer or job"
            aria-label="Search jobs"
            className="h-11 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-foreground"
          />
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>

        {/* Totals band */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-card border border-border bg-surface-hover p-4">
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-secondary-text">Jobs</span>
            <span className="tabular-nums text-lg font-semibold">{summary.count}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-secondary-text">Billed</span>
            <span className="tabular-nums text-lg font-semibold">
              {formatGBP(summary.totalBilled)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wide text-secondary-text">Collected</span>
            <span className="tabular-nums text-lg font-semibold">
              {formatGBP(summary.totalCollected)}
            </span>
          </div>
          {filter === "paid" && summary.paidFrom && summary.paidTo && (
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide text-secondary-text">Paid</span>
              <span className="text-sm font-medium">
                {formatDate(summary.paidFrom)} – {formatDate(summary.paidTo)}
              </span>
            </div>
          )}
        </div>

        {/* List */}
        {visible.length === 0 ? (
          <EmptyState title={empty.title} description={empty.description} action={emptyActions[filter]} />
        ) : filter === "active" ? (
          <div className="flex flex-col gap-6">
            {groupByUrgencyTier(visible).map(({ tier, label, jobs }) => (
              <div key={tier} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-text">
                  {label}
                </h2>
                {jobs.map((j) => (
                  <PipelineRow
                    key={j.jobId}
                    customerName={j.customerName}
                    href={`/jobs/${j.jobId}`}
                    descriptor={j.title}
                    amount={j.amount > 0 ? j.amount : undefined}
                    status={j.status}
                    dateLabel={
                      j.paidAt ? `paid ${formatRelative(j.paidAt)}` : `updated ${formatRelative(j.sortAt)}`
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map((j) => (
              <PipelineRow
                key={j.jobId}
                customerName={j.customerName}
                href={`/jobs/${j.jobId}`}
                descriptor={j.title}
                amount={j.amount > 0 ? j.amount : undefined}
                status={j.status}
                dateLabel={
                  j.paidAt ? `paid ${formatRelative(j.paidAt)}` : `updated ${formatRelative(j.sortAt)}`
                }
              />
            ))}
          </div>
        )}

        {hasMore && (
          <Link
            href={buildHref(filter, query, show + JOBS_PER_PAGE)}
            className={`${buttonClass("secondary")} self-center`}
          >
            Load more ({matched.length - visible.length} more)
          </Link>
        )}
      </main>
    </div>
  );
}
