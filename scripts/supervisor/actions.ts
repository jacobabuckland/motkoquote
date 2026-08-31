/**
 * T1–T4's runner: take the actions §7 permits, and record each with its
 * reversal instruction.
 *
 *   npx tsx scripts/supervisor/actions.ts --previous prev.json \
 *     --current cur.json --out actions.json [--dry-run]
 *
 * Writes the action list `publish.ts` puts in the digest's fourth section. The
 * decisions all live in `actions-core.ts`; this file is the part that touches
 * the outside world, and it touches it in exactly four ways.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { META_LABEL, REPO, SUPERVISOR_LABEL } from "./config";
import { gh, lastCommitAt, listFactoryIssues, listSupervisorBugs } from "./github";
import { notion } from "./notion";
import {
  REQUEUE_COMMENT,
  bugRecord,
  bugsToFile,
  duplicateRecord,
  findDuplicates,
  mayRequeue,
  mayRetryPreview,
  requeueRecord,
  retryPreviewRecord,
} from "./actions-core";
import type { ActionRecord, Snapshot } from "./types";

const DRY_RUN = process.argv.includes("--dry-run");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function read(path: string | undefined): Snapshot | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const currentPath = arg("current");
  if (!currentPath) throw new Error("--current is required");
  const current = read(currentPath);
  if (!current) throw new Error(`Could not read ${currentPath}`);
  const previous = read(arg("previous"));

  const now = current.taken_at;
  const records: ActionRecord[] = [];
  const retries = { ...(current.preview_retries ?? {}) };

  const issues = await listFactoryIssues();
  const labelsByNumber = new Map(issues.map((i) => [i.number, i.labels]));

  /* -- T1: retry a failed preview ---------------------------------------- */
  for (const [pageId, ticket] of Object.entries(current.tickets)) {
    if (!mayRetryPreview(pageId, ticket, retries, now)) continue;

    if (!DRY_RUN) {
      // Re-fire the deploy workflow rather than re-applying the label: a label
      // the issue already holds fires nothing at all, which reconcile-core.ts
      // documents as the bug rather than the fix.
      await gh(`/repos/${REPO}/actions/workflows/factory-deploy.yml/dispatches`, {
        method: "POST",
        body: JSON.stringify({ ref: "main", inputs: { issue: String(ticket.issue) } }),
      });
    }
    retries[pageId] = now;
    records.push(retryPreviewRecord(pageId, ticket));
  }

  /* -- T2: requeue a stalled ticket --------------------------------------- */
  for (const [pageId, ticket] of Object.entries(current.tickets)) {
    if (ticket.issue === null) continue;
    const labels = labelsByNumber.get(ticket.issue) ?? [];
    const commit = await lastCommitAt(`factory/${ticket.issue}`);
    if (!mayRequeue(ticket, labels, commit, now)) continue;

    if (!DRY_RUN) {
      await notion(`pages/${pageId}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: { Status: { select: { name: "Ready for factory" } } },
        }),
      });
      await gh(`/repos/${REPO}/issues/${ticket.issue}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: REQUEUE_COMMENT }),
      });
    }
    records.push(requeueRecord(pageId, ticket));
  }

  /* -- T3: duplicates — flagged, never closed ------------------------------ */
  // Notion `created_time` is the creation timestamp, which is what §7's
  // "created within the same 24h" needs. It is not `last_edited_time` and the
  // status_since prohibition does not apply to it.
  const createdAt: Record<string, string> = {};
  for (const [pageId, ticket] of Object.entries(current.tickets)) {
    if (ticket.status !== "Backlog" && ticket.status !== "Ready for factory") continue;
    const page = await notion<{ created_time?: string }>(`pages/${pageId}`);
    if (page.created_time) createdAt[pageId] = page.created_time;
  }
  for (const pair of findDuplicates(current.tickets, createdAt)) {
    records.push(duplicateRecord(pair));
  }

  /* -- T4: file a bug ------------------------------------------------------ */
  const openBugs = await listSupervisorBugs();
  for (const bug of bugsToFile(previous, current)) {
    // One ticket per distinct cause: if this cause already has an open ticket,
    // the cause is already filed. Re-filing hourly is how a supervisor teaches
    // people to ignore it.
    if (openBugs.some((i) => i.title === bug.title)) continue;

    let url = "(dry run)";
    if (!DRY_RUN) {
      const created = await gh<{ html_url: string }>(`/repos/${REPO}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title: bug.title,
          body: `${bug.body}\n\n---\nFiled by the factory supervisor at ${now}.`,
          labels: [META_LABEL, SUPERVISOR_LABEL],
        }),
      });
      url = created?.html_url ?? "(created)";
    }
    records.push(bugRecord(bug, url));
  }

  current.preview_retries = retries;
  writeFileSync(currentPath, `${JSON.stringify(current, null, 2)}\n`);
  writeFileSync(arg("out") ?? "supervisor-actions.json", `${JSON.stringify(records, null, 2)}\n`);

  console.log(`${records.length} action(s)${DRY_RUN ? " (dry run — nothing was written)" : ""}`);
  for (const r of records) console.log(`  ${r.action}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
