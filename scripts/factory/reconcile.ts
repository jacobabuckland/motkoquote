/**
 * The factory reconciler.
 *
 *   npx tsx scripts/factory/reconcile.ts [--dry-run] [--issue N]
 *
 * Reads the real state of every open `factory` item — branch head SHA, the CI
 * conclusion for that exact SHA, the PR, the latest QA verdict and the SHA it
 * reviewed, and how long the item has held its stage label — and reconciles it
 * against what the labels claim.
 *
 * It exists because the coordination layer had no durable state. A stage label
 * is a claim that a consumer owns an item, and nothing ever checked the claim:
 * an event that failed to fire left an item that silently ceased to exist, and
 * five of them sat unnoticed for three days. Labels are a doorbell; this is the
 * thing that holds the model.
 *
 * The decision logic is in ./reconcile-core.ts and has no I/O, so it is unit
 * tested against real observed shapes. This file is the plumbing: read, decide,
 * act, record.
 *
 * ACTIONS IT MAY TAKE
 *   - re-fire a stage's consumer via workflow_dispatch (never by toggling a
 *     label: re-applying a held label fires nothing, which is the bug)
 *   - correct a label that the observed state contradicts outright
 *   - escalate, as a DECISION NEEDED comment composed by the one composer the
 *     digest parses, plus the `reconciler-escalated` label that puts the item
 *     in the digest
 *
 * It never marks an item `blocked`. `blocked` means a consumer stopped and
 * asked a question; the reconciler stopping is a different fact and gets its
 * own label so the two remain distinguishable.
 */

import { execFileSync } from "node:child_process";
import {
  MAX_AUTO_REFIRES,
  STALL_THRESHOLD_MINUTES,
  reconcile,

  renderObserved,
  stageLabelsOn,
  type ActiveRun,
  type Decision,
  type LabelEvent,
  type ObservedItem,
  type QaObservation,
  type RefireRecord,
} from "./reconcile-core";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const REPO = process.env.GH_REPO ?? "jacobabuckland/motkoquote";
const TOKEN = process.env.GITHUB_TOKEN ?? "";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ISSUE = (() => {
  const i = process.argv.indexOf("--issue");
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
})();

const STATE_MARKER = "<!-- factory-reconciler-state";
const ESCALATED_LABEL = "reconciler-escalated";

/** The run-name token every stage workflow stamps, so runs can be matched to items. */
export function runToken(issue: number): string {
  return `[factory#${issue}]`;
}

interface ReconcilerState {
  version: 1;
  refires: RefireRecord[];
  lastEscalation?: { fingerprint: string; at: string };
  lastReconciledAt?: string;
}

const EMPTY_STATE: ReconcilerState = { version: 1, refires: [] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 404) return null as T;
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

/** Paginate a list endpoint to exhaustion. */
async function apiAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await api<T[]>(`${path}${sep}per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------- observation

interface RawIssue {
  number: number;
  title: string;
  labels: { name: string }[];
  pull_request?: unknown;
}

interface RawTimelineEvent {
  event: string;
  created_at?: string;
  label?: { name: string };
}

interface RawComment {
  id: number;
  body: string;
  created_at: string;
  user: { login: string } | null;
}

interface RawRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  path: string;
  head_sha: string;
}

async function observe(issue: RawIssue, now: string): Promise<{ item: ObservedItem; runs: ActiveRun[]; state: ReconcilerState; stateCommentId: number | null }> {
  const n = issue.number;
  const branchName = `factory/${n}`;

  const [timeline, comments, ref] = await Promise.all([
    apiAll<RawTimelineEvent>(`/repos/${REPO}/issues/${n}/timeline`),
    apiAll<RawComment>(`/repos/${REPO}/issues/${n}/comments`),
    api<{ object?: { sha: string } } | null>(
      `/repos/${REPO}/git/ref/heads/${encodeURIComponent(branchName)}`,
    ),
  ]);

  const labelEvents: LabelEvent[] = timeline
    .filter((e) => (e.event === "labeled" || e.event === "unlabeled") && e.label && e.created_at)
    .map((e) => ({
      name: e.label!.name,
      at: e.created_at!,
      action: e.event as "labeled" | "unlabeled",
    }));

  const sha = ref?.object?.sha ?? null;
  const branch = sha ? { name: branchName, sha } : null;

  // CI for the exact head SHA. Not the branch — a green run belonging to an
  // earlier commit is not evidence about this one, which is the lesson the
  // Engineer gate already learned the hard way.
  let ci: ObservedItem["ci"] = null;
  if (sha) {
    const runs = await api<{ workflow_runs: RawRun[] }>(
      `/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=50`,
    );
    const ciRun = runs?.workflow_runs?.find((r) => r.path.endsWith("/ci.yml"));
    if (ciRun) {
      ci = {
        sha,
        status: ciRun.status as "queued" | "in_progress" | "completed",
        conclusion: ciRun.conclusion,
        url: ciRun.html_url,
      };
    }
  }

  // What the branch introduced, as a three-dot comparison against main. Three
  // dots, not two: a two-dot diff compares tips, so everything merged to main
  // since this branch was cut shows up as though the branch had touched it —
  // which would make a branch carrying nothing but a spec look like it had an
  // implementation as soon as main moved.
  let branchContent: ObservedItem["branchContent"] = null;
  if (sha) {
    const cmp = await api<{ files?: { filename: string }[] }>(
      `/repos/${REPO}/compare/main...${encodeURIComponent(branchName)}`,
    );
    const files = (cmp?.files ?? []).map((f) => f.filename);
    branchContent = {
      hasSpec: files.some((f) => f === `docs/specs/${n}.md`),
      hasTests: files.some((f) => f.startsWith(`tests/acceptance/${n}.test.`)),
      hasImplementation: files.some(
        (f) => !f.startsWith("docs/specs/") && !f.startsWith("tests/acceptance/"),
      ),
    };
  }

  const owner = REPO.split("/")[0];
  const prs = await api<
    { number: number; draft: boolean; state: string }[]
  >(`/repos/${REPO}/pulls?head=${owner}:${branchName}&state=open`);
  let pr: ObservedItem["pr"] = null;
  if (prs && prs.length > 0) {
    const full = await api<{
      number: number;
      draft: boolean;
      state: string;
      mergeable: boolean | null;
      mergeable_state: string | null;
    }>(`/repos/${REPO}/pulls/${prs[0].number}`);
    if (full) {
      pr = {
        number: full.number,
        draft: full.draft,
        state: full.state,
        mergeable: full.mergeable,
        mergeableState: full.mergeable_state,
      };
    }
  }

  const qa = latestQaVerdict(comments);

  const stateComment = [...comments].reverse().find((c) => c.body.includes(STATE_MARKER)) ?? null;
  const state = stateComment ? parseState(stateComment.body) : { ...EMPTY_STATE };

  const activeRuns = await activeRunsFor(n);

  const item: ObservedItem = {
    number: n,
    title: issue.title,
    labels: issue.labels.map((l) => l.name),
    branch,
    branchContent,
    ci,
    pr,
    qa,
    labelEvents,
    refires: state.refires,
  };
  void now;
  return { item, runs: activeRuns, state, stateCommentId: stateComment?.id ?? null };
}

/**
 * The latest QA verdict and the SHA it reviewed.
 *
 * QA stamps a machine-readable marker on its verdict comment. Comments written
 * before that marker existed parse to a verdict with a null SHA, which is
 * correct rather than convenient: every decision that turns on the verdict is
 * gated on SHA equality, so an unstamped verdict simply decides nothing.
 */
export function latestQaVerdict(comments: { body: string; created_at: string }[]): QaObservation | null {
  for (const c of [...comments].reverse()) {
    const marked = /<!--\s*qa-verdict\s+verdict=(PASS|CHANGES)\s+sha=([0-9a-f]{7,40})\s*-->/.exec(c.body);
    if (marked) {
      return { verdict: marked[1] as "PASS" | "CHANGES", sha: marked[2], at: c.created_at };
    }
    if (c.body.startsWith("**QA passed**")) {
      return { verdict: "PASS", sha: null, at: c.created_at };
    }
    if (c.body.startsWith("**QA findings**")) {
      return { verdict: "CHANGES", sha: null, at: c.created_at };
    }
  }
  return null;
}

/**
 * Runs currently in flight for an item, matched on the run NAME.
 *
 * Not on the head branch: a run triggered by `issues.labeled` reports
 * `head_branch: main`, so branch matching would see no label-triggered stage as
 * running and would double-fire against every one of them. For the PM stage the
 * branch does not exist at all until it pushes, so there is nothing to match on
 * even in principle. Every stage workflow therefore stamps `[factory#N]` into
 * its `run-name`, which GitHub evaluates when the run is QUEUED — so a stage is
 * visible as running from before its first step.
 */
async function activeRunsFor(issue: number): Promise<ActiveRun[]> {
  const token = runToken(issue);
  const out: ActiveRun[] = [];
  for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
    const res = await api<{ workflow_runs: RawRun[] }>(
      `/repos/${REPO}/actions/runs?status=${status}&per_page=100`,
    );
    for (const r of res?.workflow_runs ?? []) {
      if (!r.display_title?.includes(token) && !r.name?.includes(token)) continue;
      if (!r.path.includes("factory-")) continue;
      if (r.path.endsWith("/factory-reconciler.yml")) continue;
      out.push({
        workflow: r.path.split("/").pop() ?? r.path,
        runId: r.id,
        status: r.status,
        url: r.html_url,
      });
    }
  }
  return out;
}

export function parseState(body: string): ReconcilerState {
  const m = /<!--\s*factory-reconciler-state\s*([\s\S]*?)-->/.exec(body);
  if (!m) return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(m[1]) as ReconcilerState;
    if (parsed.version !== 1 || !Array.isArray(parsed.refires)) return { ...EMPTY_STATE };
    return parsed;
  } catch {
    return { ...EMPTY_STATE };
  }
}

// -------------------------------------------------------------------- acting

function decisionSection(
  issue: number,
  stage: string,
  question: string,
  options: string,
  recommendation: string,
): string {
  return execFileSync(
    "scripts/factory/decision-section.sh",
    [String(issue), stage, question, options, recommendation],
    { encoding: "utf8" },
  );
}

/**
 * A stable identity for an escalation, so the same unanswered question is not
 * re-posted every fifteen minutes. Includes the observed facts that would have
 * to change for the question to be a different one.
 */
export function escalationFingerprint(item: ObservedItem, d: Extract<Decision, { kind: "escalate" }>): string {
  return [d.reason, stageLabelsOn(item).join("+"), item.branch?.sha ?? "no-branch", item.qa?.verdict ?? "no-qa"].join("|");
}

async function act(
  item: ObservedItem,
  runs: ActiveRun[],
  decision: Decision,
  state: ReconcilerState,
  stateCommentId: number | null,
  now: string,
): Promise<string> {
  const n = item.number;
  let note = `#${n}: ${decision.kind} — ${"reason" in decision ? decision.reason : ""}`;
  let stateChanged = false;

  if (decision.kind === "correct-label") {
    note += ` (add: ${decision.add.join(",") || "none"}; remove: ${decision.remove.join(",") || "none"})`;
    if (!DRY_RUN) {
      for (const label of decision.add) {
        await api(`/repos/${REPO}/issues/${n}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels: [label] }),
        });
      }
      for (const label of decision.remove) {
        await api(`/repos/${REPO}/issues/${n}/labels/${encodeURIComponent(label)}`, {
          method: "DELETE",
        });
      }
      await api(`/repos/${REPO}/issues/${n}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: [
            `**Reconciler corrected a label that the branch contradicts.**`,
            ``,
            decision.reason.charAt(0).toUpperCase() + decision.reason.slice(1) + ".",
            ``,
            renderObserved(item, runs, now),
            ``,
            `Added: ${decision.add.map((l) => `\`${l}\``).join(", ") || "_nothing_"}. Removed: ${decision.remove.map((l) => `\`${l}\``).join(", ") || "_nothing_"}.`,
          ].join("\n"),
        }),
      });
    }
  }

  if (decision.kind === "refire") {
    note += ` → dispatch ${decision.workflow}`;
    if (!DRY_RUN) {
      await api(`/repos/${REPO}/actions/workflows/${decision.workflow}/dispatches`, {
        method: "POST",
        body: JSON.stringify({
          ref: "main",
          inputs: {
            issue: String(n),
            stage: decision.stage,
            reason: `reconciler: ${decision.reason}`,
          },
        }),
      });
    }
    const existing = state.refires.find((r) => r.key === decision.key);
    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
    } else {
      state.refires.push({ key: decision.key, count: 1, lastAt: now });
    }
    stateChanged = true;
  }

  if (decision.kind === "escalate") {
    const fingerprint = escalationFingerprint(item, decision);
    if (state.lastEscalation?.fingerprint === fingerprint) {
      note += " (already reported, not re-posting)";
    } else {
      if (!DRY_RUN) {
        const body = [
          `**Reconciler cannot resolve this item.**`,
          ``,
          `This is what it read, ${STALL_THRESHOLD_MINUTES} minutes or more after the item last moved:`,
          ``,
          renderObserved(item, runs, now),
          ``,
          decisionSection(
            n,
            decision.resumeStage ?? "none",
            decision.question,
            decision.options,
            decision.recommendation,
          ),
        ].join("\n");
        await api(`/repos/${REPO}/issues/${n}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        await api(`/repos/${REPO}/issues/${n}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels: [ESCALATED_LABEL] }),
        });
      }
      state.lastEscalation = { fingerprint, at: now };
      stateChanged = true;
    }
  }

  // An item that has stopped being escalated has moved on: clear the marker so
  // it leaves the digest by itself rather than needing a human to tidy it.
  if (decision.kind !== "escalate" && item.labels.includes(ESCALATED_LABEL)) {
    note += " (clearing reconciler-escalated)";
    if (!DRY_RUN) {
      await api(`/repos/${REPO}/issues/${n}/labels/${ESCALATED_LABEL}`, { method: "DELETE" });
    }
    delete state.lastEscalation;
    stateChanged = true;
  }

  if (stateChanged && !DRY_RUN) {
    state.lastReconciledAt = now;
    await writeState(n, state, stateCommentId, item, runs, now);
  }

  return note;
}

/**
 * The durable state record, kept as ONE comment per item and rewritten in
 * place. Written only for items that have a ledger or an open escalation —
 * a quiet item stays quiet — so the record's existence is itself a signal.
 */
async function writeState(
  issue: number,
  state: ReconcilerState,
  commentId: number | null,
  item: ObservedItem,
  runs: ActiveRun[],
  now: string,
): Promise<void> {
  const body = [
    `### Factory state — reconciler`,
    ``,
    renderObserved(item, runs, now),
    ``,
    state.refires.length > 0
      ? `Automatic re-fires (max ${MAX_AUTO_REFIRES} per stage+commit):\n\n` +
        state.refires.map((r) => `- \`${r.key}\` — ${r.count}, last ${r.lastAt}`).join("\n")
      : `No automatic re-fires recorded.`,
    ``,
    `_Rewritten in place by the reconciler. This comment is the item's durable state; the labels are a view of it._`,
    ``,
    `${STATE_MARKER}`,
    JSON.stringify(state),
    `-->`,
  ].join("\n");

  if (commentId) {
    await api(`/repos/${REPO}/issues/comments/${commentId}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
  } else {
    await api(`/repos/${REPO}/issues/${issue}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }
}

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set — the reconciler reads real state and cannot run without it.");
  const now = new Date().toISOString();

  const raw = await apiAll<RawIssue>(`/repos/${REPO}/issues?labels=factory&state=open`);
  const issues = raw
    .filter((i) => !i.pull_request)
    .filter((i) => ONLY_ISSUE === null || i.number === ONLY_ISSUE);

  const notes: string[] = [];
  const escalations: string[] = [];
  let refired = 0;
  let corrected = 0;

  for (const issue of issues) {
    try {
      const { item, runs, state, stateCommentId } = await observe(issue, now);
      const decision = reconcile(item, runs, now);
      const note = await act(item, runs, decision, state, stateCommentId, now);
      notes.push(note);
      if (decision.kind === "refire") refired++;
      if (decision.kind === "correct-label") corrected++;
      if (decision.kind === "escalate") {
        escalations.push(`- [#${item.number}](https://github.com/${REPO}/issues/${item.number}) — ${item.title}\n  - ${decision.reason}`);
      }
    } catch (err) {
      // A failure to reconcile ONE item must never take the sweep down with it,
      // and must never be silent either — an item the reconciler could not read
      // is exactly as invisible as one it never looked at.
      const message = err instanceof Error ? err.message : String(err);
      notes.push(`#${issue.number}: ERROR — ${message}`);
      escalations.push(`- #${issue.number} — the reconciler could not read this item: ${message}`);
    }
  }

  const summary = [
    `## Factory reconciler — ${now}`,
    ``,
    `${issues.length} open factory item(s) read${DRY_RUN ? " (DRY RUN — nothing was written)" : ""}.`,
    `Re-fired: ${refired}. Labels corrected: ${corrected}. Escalated: ${escalations.length}.`,
    ``,
    ...notes.map((n) => `- ${n}`),
    ``,
    escalations.length > 0
      ? `### Could not resolve\n\n${escalations.join("\n")}`
      : `Nothing was left unresolved.`,
  ].join("\n");

  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  }
}

// Only run when invoked directly, so the tests can import the helpers above.
if (process.argv[1]?.endsWith("reconcile.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
