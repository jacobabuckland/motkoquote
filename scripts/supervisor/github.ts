/**
 * GitHub reads for the supervisor.
 *
 * §4.2/§4.3 resolved to "structured, read from it", and what they resolved to
 * is GitHub state: halts are stopped labels plus a `## DECISION NEEDED`
 * comment, QA rejections are `qa-changes` label events, preview status is a
 * GitHub Deployment. Notion is the mirror, so this file — not `notion.ts` — is
 * where most of a ticket's real state comes from.
 */

import {
  GITHUB_API,
  LIVE_CHECKS_STALE_HOURS,
  LIVE_CHECKS_WORKFLOW,
  META_LABEL,
  QA_REJECTION_LABEL,
  REPO,
  STOPPED_LABELS,
  SUPERVISOR_LABEL,
} from "./config";
import type { CiState, LiveChecks, PreviewStatus } from "./types";

const TOKEN = process.env.FACTORY_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  created_at: string;
  html_url: string;
}

export interface LabelEvent {
  issue: number;
  event: "labeled" | "unlabeled";
  label: string;
  created_at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gh<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!TOKEN) {
    throw new Error(
      "CAPABILITY FAULT: no GitHub token (FACTORY_TOKEN / GH_TOKEN / GITHUB_TOKEN). The supervisor cannot read issue state.",
    );
  }

  let wait = 1000;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${TOKEN}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (res.status === 404) return null;
    if (res.status === 204) return null;
    if (res.ok) return (await res.json()) as T;

    // 403 with a rate-limit remaining of 0 is a rate limit, not a permission
    // problem; both arrive as 403 and only the header tells them apart.
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");

    if (rateLimited || res.status >= 500) {
      if (attempt === 4) {
        throw new Error(`GitHub ${path}: ${res.status} after ${attempt} attempts — abandoning the run.`);
      }
      await sleep(wait);
      wait *= 2;
      continue;
    }

    throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  }
  return null;
}

async function paged<T>(path: string, max = 10): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= max; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await gh<T[]>(`${path}${sep}per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  created_at: string;
  html_url: string;
  pull_request?: unknown;
}

/**
 * Every factory issue, open and closed.
 *
 * Closed ones are needed: a shipped ticket's `status_since` and its QA
 * rejection count are still part of the week's metrics, and an item that
 * closed since the last run is a status transition that must appear in the
 * digest.
 *
 * `pull_request` is filtered because GitHub's issues endpoint returns PRs too,
 * and a PR carrying the `factory` label would otherwise appear on the board as
 * a ticket that no Notion page can explain.
 */
export async function listFactoryIssues(): Promise<Issue[]> {
  const raw = await paged<RawIssue>(`/repos/${REPO}/issues?state=all&labels=factory`);
  return raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      labels: (i.labels ?? []).map((l) => l.name),
      created_at: i.created_at,
      html_url: i.html_url,
    }))
    .filter((i) => !i.labels.includes(META_LABEL));
}

interface RawEvent {
  event: string;
  label?: { name: string };
  created_at: string;
  issue?: { number: number };
}

/**
 * Recent label events across the whole repository, newest first.
 *
 * One repo-wide read rather than one read per issue. The per-issue shape is
 * O(tickets) requests every hour against a rate limit shared with five other
 * factory workflows, and the repo-wide endpoint carries the same data. Ten
 * pages is roughly a fortnight of this factory's label churn, which comfortably
 * covers every threshold in the table (the longest is 72h).
 */
export async function listLabelEvents(): Promise<LabelEvent[]> {
  const raw = await paged<RawEvent>(`/repos/${REPO}/issues/events`, 10);
  return raw
    .filter(
      (e): e is RawEvent & { label: { name: string }; issue: { number: number } } =>
        (e.event === "labeled" || e.event === "unlabeled") &&
        Boolean(e.label?.name) &&
        Boolean(e.issue?.number),
    )
    .map((e) => ({
      issue: e.issue.number,
      event: e.event as "labeled" | "unlabeled",
      label: e.label.name,
      created_at: e.created_at,
    }));
}

/** §4.3: rejections are counted from events, so a cleared label still counts. */
export function countQaRejections(events: LabelEvent[], issue: number): number {
  return events.filter(
    (e) => e.issue === issue && e.event === "labeled" && e.label === QA_REJECTION_LABEL,
  ).length;
}

/** §4.2: any of the four stopped labels, on an open issue. */
export function hasStoppedLabel(labels: string[]): boolean {
  return STOPPED_LABELS.some((l) => labels.includes(l));
}

/**
 * When the issue most recently entered the state it is in now.
 *
 * The label whose application produced the current status is the one to date
 * from, so this asks for the newest `labeled` event among the labels the issue
 * currently holds that are relevant to status. Returns null when the event
 * window does not reach back far enough — the caller then carries the previous
 * snapshot's value forward rather than inventing one, which is the whole point
 * of not using `last_edited_time`.
 */
export function statusSinceFromEvents(
  events: LabelEvent[],
  issue: number,
  currentLabels: string[],
): string | null {
  const relevant = new Set<string>([
    ...STOPPED_LABELS,
    "needs-spec",
    "spec-derived",
    "verify",
    QA_REJECTION_LABEL,
    "previewed",
    "shipped",
  ]);

  const candidates = events
    .filter(
      (e) =>
        e.issue === issue &&
        e.event === "labeled" &&
        relevant.has(e.label) &&
        currentLabels.includes(e.label),
    )
    .map((e) => e.created_at)
    .sort();

  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

/**
 * The Notion page id an issue body refers to.
 *
 * A direct port of `scripts/factory/notion-page-id.sh`, including its fallback
 * and the reason for it: a card body edited by hand loses the invisible HTML
 * comment, and on 30 Aug four items had silently diverged that way. The visible
 * `**Source:**` link survives an edit, so it is the second source.
 *
 * Ported rather than shelled out to because this runs inside a script that
 * already holds the body in memory, and spawning a shell per ticket to re-parse
 * a string it already has is a cost with no benefit.
 */
export function notionPageIdFromBody(body: string | null): string | null {
  if (!body) return null;

  const marker = body.match(/notion-page-id:\s*([0-9a-fA-F-]{32,36})/);
  if (marker) return normalisePageId(marker[1]);

  // Anchor on the trailing hex run before the closing paren: a Notion URL is
  // <slugified-title>-<32 hex>, and a title can itself contain a hex-looking
  // run.
  const link = body.match(/\(https:\/\/[^)]*notion\.[a-z]+\/[^)]*\)/);
  if (link) {
    const ids = link[0].match(/[0-9a-fA-F]{32}/g);
    if (ids && ids.length > 0) return normalisePageId(ids[ids.length - 1]);
  }

  return null;
}

/** Notion returns dashed ids and writes undashed ones; compare on undashed. */
export function normalisePageId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

/**
 * What a board's `GitHub Issue` property actually points at.
 *
 * Both paths are read, because both are in use and only one was recognised.
 * On 31 Aug the live board held 38 rows whose property is a `/pull/` URL — 36
 * of the Bugs board's 45 linked rows — and every one of them counted as
 * unlinked, because the parser matched `/issues/(\d+)` and nothing else. The
 * Bugs convention is to link the PR that fixed the bug, which is a reasonable
 * thing for a bugs board to record and is not a board error to be tidied away.
 *
 * The two are kept apart rather than merged. On GitHub they share one number
 * space, so `/pull/431` and `/issues/431` name the same object and the naive
 * fix is to normalise and move on — but they do not carry the same DATA. The
 * supervisor reads stopped labels, `qa_rejections` and issue state off the
 * linked object, and a pull request carries none of those. Treating a PR link
 * as an issue link would resolve `halt_open: false` for a ticket whose halt
 * nobody had looked at, which is worse than reporting it unlinked.
 */
export function issueRefFromUrl(url: string | null): { number: number; kind: "issue" | "pull" } | null {
  if (!url) return null;
  const match = url.match(/\/(issues|pull)\/(\d+)/);
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isFinite(number) ? { number, kind: match[1] === "pull" ? "pull" : "issue" } : null;
}

/** The default branch's head SHA and the conclusion of its checks. */
export async function mainStatus(): Promise<{ sha: string; ci: CiState; run_url: string | null }> {
  const branch = await gh<{ commit: { sha: string } }>(`/repos/${REPO}/branches/main`);
  const sha = branch?.commit?.sha ?? "";
  if (!sha) return { sha: "", ci: "pending", run_url: null };

  // The CI gate is a workflow run, not a commit status, so ask for runs on this
  // exact SHA. Asking the combined-status endpoint returns whatever Vercel last
  // posted and says nothing about whether the test suite passed.
  const runs = await gh<{
    workflow_runs: { name: string; status: string; conclusion: string | null; html_url: string }[];
  }>(`/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=50`);

  const gate = (runs?.workflow_runs ?? []).filter((r) => r.name === "CI");
  if (gate.length === 0) return { sha, ci: "pending", run_url: null };

  const newest = gate[0];
  const ci: CiState =
    newest.status !== "completed"
      ? "pending"
      : newest.conclusion === "success"
        ? "green"
        : "red";

  return { sha, ci, run_url: newest.html_url };
}

/**
 * The live-checks lane's most recent completed run.
 *
 * This is the supervisor's only window onto PRODUCTION. Every other signal it
 * reads — ticket status, main CI, previews, halts — is about the factory's own
 * machinery, so a production regression that no ticket touches is invisible to
 * it. On 31 Aug a SECURITY DEFINER function callable by `anon` had been live for
 * weeks with every gate green, and nothing in the factory was looking.
 *
 * Asks the workflow endpoint by FILE NAME, which is stable, rather than
 * filtering runs by display name, which is not.
 *
 * A lane that has stopped firing is reported as `stale` rather than as green.
 * That distinction is the whole point: an absent answer is not a passing one,
 * and this workflow's own header says a check with no runner has quietly
 * stopped existing.
 */
export async function liveChecksStatus(now: string): Promise<LiveChecks> {
  const runs = await gh<{
    workflow_runs: {
      status: string;
      conclusion: string | null;
      html_url: string;
      updated_at: string;
    }[];
  }>(`/repos/${REPO}/actions/workflows/${LIVE_CHECKS_WORKFLOW}/runs?per_page=10`);

  const all = runs?.workflow_runs ?? [];
  const completed = all
    .filter((r) => r.status === "completed" && r.conclusion !== null)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const newest = completed[0];

  if (!newest) {
    // Never run, or every run in the window is still going. Not green, and not
    // red either — `pending` plus `stale` says "nobody knows", which is the
    // honest answer and the one that reaches the digest.
    return {
      state: "pending",
      run_url: all[0]?.html_url ?? null,
      completed_at: null,
      stale: all.length === 0,
    };
  }

  const hoursSince = (Date.parse(now) - Date.parse(newest.updated_at)) / 3_600_000;

  return {
    state: newest.conclusion === "success" ? "green" : "red",
    run_url: newest.html_url,
    completed_at: newest.updated_at,
    stale: hoursSince >= LIVE_CHECKS_STALE_HOURS,
  };
}

interface Deployment {
  id: number;
  sha: string;
  created_at: string;
}

/**
 * Preview status for a branch, from GitHub Deployments (§4.4 — no Vercel token).
 *
 * Reproduces the two details `factory-deploy.yml` learned the hard way: take
 * the NEWEST deployment that succeeded, because a retried deploy leaves the
 * older failed one on the same SHA; and never read `environment_url` as
 * evidence of success, because Vercel sets it on failures too.
 */
export async function previewStatus(branch: string): Promise<PreviewStatus> {
  const deployments = await gh<Deployment[]>(
    `/repos/${REPO}/deployments?ref=${encodeURIComponent(branch)}&environment=Preview&per_page=10`,
  );
  if (!deployments || deployments.length === 0) return "unknown";

  // Newest first is what the API returns; be explicit rather than relying on it.
  const ordered = [...deployments].sort((a, b) => b.created_at.localeCompare(a.created_at));

  for (const d of ordered) {
    const statuses = await gh<{ state: string; created_at: string }[]>(
      `/repos/${REPO}/deployments/${d.id}/statuses?per_page=100`,
    );
    const newest = (statuses ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!newest) continue;

    if (newest.state === "success") return "ready";
    if (newest.state === "failure" || newest.state === "error") return "failed";
    if (newest.state === "pending" || newest.state === "in_progress") return "building";
  }

  return "unknown";
}

/** The factory's PR for an issue, if its branch has one open or merged. */
export async function prForIssue(issue: number): Promise<string | null> {
  const prs = await gh<{ html_url: string }[]>(
    `/repos/${REPO}/pulls?head=${REPO.split("/")[0]}:factory/${issue}&state=all&per_page=5`,
  );
  return prs && prs.length > 0 ? prs[0].html_url : null;
}

/** Newest commit time on a branch, or null when the branch does not exist. */
export async function lastCommitAt(branch: string): Promise<string | null> {
  const commits = await gh<{ commit: { committer: { date: string } } }[]>(
    `/repos/${REPO}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
  );
  return commits && commits.length > 0 ? commits[0].commit.committer.date : null;
}

/**
 * Bugs the supervisor has filed, open only.
 *
 * A separate read rather than a filter over `listFactoryIssues`, because these
 * carry `factory-meta` and that function excludes it by design — the tracker
 * must not appear in its own digest. Without this the T4 dedup check would
 * never find an existing ticket and would file the same bug every hour, which
 * is the failure mode "one ticket per distinct cause" exists to prevent.
 */
export async function listSupervisorBugs(): Promise<Issue[]> {
  const raw = await paged<RawIssue>(
    `/repos/${REPO}/issues?state=open&labels=${encodeURIComponent(SUPERVISOR_LABEL)}`,
  );
  return raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      labels: (i.labels ?? []).map((l) => l.name),
      created_at: i.created_at,
      html_url: i.html_url,
    }));
}
