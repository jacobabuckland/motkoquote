/**
 * Append a block or resolution record to the factory ledger.
 *
 *   ISSUE=239 ACTION=labeled LABEL=blocked npx tsx scripts/factory/record-block.ts
 *
 * Driven by the label event rather than by instrumenting each blocking path.
 * There are seventeen places that can stop an item and there will be more; every
 * one of them ends by applying a stopped label, so that is the one place worth
 * watching. It also catches a human stopping an item by hand, which no amount of
 * instrumenting the agents would.
 *
 * Records go to the tracker issue, because that is the one place a label cannot
 * reach — `resume.sh` strips stopped labels and ship clears stage labels, so
 * anything written into the item's own labels is gone by the time you want to
 * count it.
 */

import {
  categorise,
  neededHumanFor,
  parseRecords,
  refineOnResolution,
  renderRecord,
  type BlockRecord,
} from "./block-ledger";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const REPO = process.env.GH_REPO ?? "jacobabuckland/motkoquote";
const TOKEN = process.env.GITHUB_TOKEN ?? "";
const TRACKER = process.env.TRACKER ?? "157";
const ISSUE = Number(process.env.ISSUE ?? "0");
const ACTION = process.env.ACTION ?? "";
const LABEL = process.env.LABEL ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

const STOPPED = ["blocked", "qa-disputed", "spec-dispute", "reconciler-escalated"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${TOKEN}`,
      "x-github-api-version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (res.status === 404) return null as T;
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status}`);
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

async function allComments(issue: string | number): Promise<{ body: string; created_at: string }[]> {
  const out: { body: string; created_at: string }[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api<{ body: string; created_at: string }[]>(
      `/repos/${REPO}/issues/${issue}/comments?per_page=100&page=${page}`,
    );
    if (!batch || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Pull the evidence out of the blocking comment the workflows already write.
 *
 * Attribution only — the "files the Engineer may not edit" and "attributes the
 * failure to" blocks, which name files the log identified as FAILING. A frozen
 * path mentioned anywhere else in a comment is not evidence, which is the same
 * distinction attribute-failure.sh draws.
 */
export function readEvidence(comment: string): {
  frozenAttributed: string[];
  failingSources: string[];
  failingStep: string | null;
} {
  const fenced = (heading: RegExp): string[] => {
    const at = heading.exec(comment);
    if (!at) return [];
    const after = comment.slice(at.index);
    const block = /```\n([\s\S]*?)```/.exec(after);
    if (!block) return [];
    return block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  };

  const frozenAttributed = fenced(/names files the Engineer may not edit/);
  const attributed = fenced(/attributes the failure to/);
  const step = /failed at step \*\*(.+?)\*\*/.exec(comment)?.[1] ?? null;

  return {
    frozenAttributed,
    failingSources: [...new Set([...frozenAttributed, ...attributed])],
    failingStep: step,
  };
}

async function headSha(issue: number): Promise<string | null> {
  const ref = await api<{ object?: { sha: string } } | null>(
    `/repos/${REPO}/git/ref/heads/${encodeURIComponent(`factory/${issue}`)}`,
  );
  return ref?.object?.sha ?? null;
}

function stageOf(labels: string[]): string | null {
  return (
    labels.find((l) => ["needs-spec", "spec-derived", "verify", "qa-changes"].includes(l)) ?? null
  );
}

async function main(): Promise<void> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is not set.");
  if (!ISSUE || !STOPPED.includes(LABEL)) {
    console.log(`Nothing to record: issue=${ISSUE} label=${LABEL}`);
    return;
  }

  const now = new Date().toISOString();
  const sha = await headSha(ISSUE);
  const issueData = await api<{ labels: { name: string }[] }>(`/repos/${REPO}/issues/${ISSUE}`);
  const labels = (issueData?.labels ?? []).map((l) => l.name);

  const ledger = parseRecords((await allComments(TRACKER)).map((c) => c.body));

  if (ACTION === "labeled") {
    const comments = await allComments(ISSUE);
    const latest = comments.length > 0 ? comments[comments.length - 1].body : "";
    const evidence = readEvidence(latest);
    const record: BlockRecord = {
      kind: "block",
      issue: ISSUE,
      label: LABEL,
      at: now,
      sha,
      stage: stageOf(labels),
      failingStep: evidence.failingStep,
      category: categorise({ label: LABEL, comment: latest, ...evidence }),
      neededHuman: null,
      minutesBlocked: null,
    };
    console.log(renderRecord(record));
    if (!DRY_RUN) {
      await api(`/repos/${REPO}/issues/${TRACKER}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: renderRecord(record) }),
      });
    }
    return;
  }

  if (ACTION === "unlabeled") {
    // The most recent block for this issue and label that has not been resolved.
    const blocks = ledger.filter((r) => r.kind === "block" && r.issue === ISSUE && r.label === LABEL);
    const resolutions = ledger.filter(
      (r) => r.kind === "resolution" && r.issue === ISSUE && r.label === LABEL,
    );
    const open = blocks[blocks.length - 1];
    if (!open || resolutions.length >= blocks.length) {
      console.log(`No open block record for #${ISSUE} at ${LABEL} — nothing to resolve.`);
      return;
    }

    const minutes = Math.round((Date.parse(now) - Date.parse(open.at)) / 60000);
    // The reconciler clears its own escalation once observed state moves on;
    // every other stopped label exists to ask a person a question, so its
    // removal is a person answering.
    const clearedByReconciler = LABEL === "reconciler-escalated";
    const record: BlockRecord = {
      ...open,
      kind: "resolution",
      at: now,
      sha,
      category: refineOnResolution(open.category, open.sha, sha),
      neededHuman: neededHumanFor(LABEL, clearedByReconciler),
      minutesBlocked: minutes,
    };
    console.log(renderRecord(record));
    if (!DRY_RUN) {
      await api(`/repos/${REPO}/issues/${TRACKER}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: renderRecord(record) }),
      });
    }
    return;
  }

  console.log(`Unrecognised action '${ACTION}'.`);
}

if (process.argv[1]?.endsWith("record-block.ts")) {
  main().catch((err) => {
    // A ledger failure must never be able to stop the factory. It is
    // bookkeeping; the item's own state is unaffected either way.
    console.error(`::warning::Could not record to the block ledger: ${String(err)}`);
  });
}
