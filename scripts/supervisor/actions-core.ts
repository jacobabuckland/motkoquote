/**
 * §7's action decisions, as pure functions.
 *
 * §7 is an enumeration, and an enumeration is only a safety property if the
 * thing that decides is separable from the thing that acts. Each function here
 * answers "may this action be taken, on this state" and returns the reversal
 * instruction alongside — because §7 requires every action listed in the digest
 * with one, and a reversal composed at the call site is one that drifts from
 * what the action actually did.
 *
 * Every decision defaults to NOT acting. The supervisor is a reporting surface
 * with four narrow powers, and the cost asymmetry is stark: a missed action is
 * a line in a digest a human reads within the hour, while a wrong action moves
 * a real ticket on a real board.
 */

import { PREVIEW_RETRY_COOLDOWN_HOURS, REQUEUE_STALE_HOURS, STOPPED_LABELS } from "./config";
import { hoursBetween } from "./snapshot-core";
import type { ActionRecord, Snapshot, TicketSnapshot } from "./types";

/* -------------------------------------------------------------------------- */
/* T1 — retry a failed preview deploy                                         */
/* -------------------------------------------------------------------------- */

export function mayRetryPreview(
  pageId: string,
  ticket: TicketSnapshot,
  retries: Record<string, string>,
  now: string,
): boolean {
  if (ticket.preview_status !== "failed") return false;
  if (ticket.issue === null) return false;

  const last = retries[pageId];
  if (!last) return true;
  return hoursBetween(last, now) >= PREVIEW_RETRY_COOLDOWN_HOURS;
}

export function retryPreviewRecord(pageId: string, ticket: TicketSnapshot): ActionRecord {
  return {
    action: `Retried the failed preview deploy for ${ticket.name} (#${ticket.issue})`,
    page_id: pageId,
    reversal: `Nothing to undo — a retry only re-runs factory-deploy.yml for #${ticket.issue}. To stop further retries, remove the \`previewed\` label from #${ticket.issue}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* T2 — requeue a stalled ticket                                              */
/* -------------------------------------------------------------------------- */

/**
 * `In factory` for over 4h with no commits on its PR in that window.
 *
 * The label check is the load-bearing one: §7 says "never for `Blocked`", and
 * more broadly a stopped item is stopped ON PURPOSE — requeueing one would have
 * the supervisor silently resolving a decision Jacob was meant to make, which
 * is the exact thing D10 and the fourth hard constraint forbid. Checking the
 * labels rather than only the Notion status matters because the status is a
 * mirror: it can lag, and a lagging mirror that still says `In factory` is
 * precisely when this would fire wrongly.
 */
export function mayRequeue(
  ticket: TicketSnapshot,
  labels: string[],
  lastCommitAt: string | null,
  now: string,
): boolean {
  if (ticket.status !== "In factory") return false;
  if (ticket.issue === null) return false;
  if (ticket.halt_open) return false;
  if (STOPPED_LABELS.some((l) => labels.includes(l))) return false;
  if (hoursBetween(ticket.status_since, now) < REQUEUE_STALE_HOURS) return false;

  // No branch yet is itself the stall — the Engineer never got started.
  if (!lastCommitAt) return true;
  return hoursBetween(lastCommitAt, now) >= REQUEUE_STALE_HOURS;
}

export function requeueRecord(pageId: string, ticket: TicketSnapshot): ActionRecord {
  return {
    action: `Requeued ${ticket.name} (#${ticket.issue}) — \`In factory\` with no activity for ${REQUEUE_STALE_HOURS}h`,
    page_id: pageId,
    reversal: `Set the Notion Status of ${ticket.name} back to "In factory" and re-apply the stage label it held on #${ticket.issue}.`,
  };
}

export const REQUEUE_COMMENT = `Requeued by supervisor: no activity for ${REQUEUE_STALE_HOURS}h`;

/* -------------------------------------------------------------------------- */
/* T3 — duplicate handling                                                    */
/* -------------------------------------------------------------------------- */

export interface DuplicatePair {
  keep: string;
  close: string;
  title: string;
}

/**
 * §7's duplicate rule, and its own admission that it is unsound.
 *
 * The spec says: same DB, identical title, both created within the same 24h,
 * both `Backlog` or `Ready for factory`, both agent-created — then "Newer one →
 * Status `Shipped` is wrong; use the DB's closed state if one exists, otherwise
 * leave and flag. **If in doubt, flag, don't close.**"
 *
 * There is no closed state on this board. §5's status enumeration is the whole
 * vocabulary the factory writes and every one of its seven values means the
 * ticket is live somewhere; `Shipped` is the terminal one and the spec rules it
 * out explicitly, correctly — writing "Shipped" on a duplicate would put a
 * thing that was never built into the shipped column and out of every count
 * that matters.
 *
 * So this function finds pairs and never closes any. That is not the rule being
 * declined: it is the rule's own stated fallback, reached because its
 * precondition is absent. If a closed state is added to the board later, the
 * close path is a small change here and a decision record in areas/motko.md.
 */
export function findDuplicates(
  tickets: Record<string, TicketSnapshot>,
  createdAt: Record<string, string>,
): DuplicatePair[] {
  const eligible = Object.entries(tickets).filter(
    ([id, t]) =>
      (t.status === "Backlog" || t.status === "Ready for factory") &&
      t.name !== "(untitled)" &&
      createdAt[id] !== undefined,
  );

  const pairs: DuplicatePair[] = [];
  const byKey = new Map<string, [string, TicketSnapshot][]>();

  for (const entry of eligible) {
    // Same DB is part of the key: a roadmap item and a bug report can legitimately
    // share a title, and they are not duplicates of one another.
    const key = `${entry[1].db}::${entry[1].name.trim().toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }

  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => createdAt[a[0]].localeCompare(createdAt[b[0]]));
    for (let i = 1; i < sorted.length; i++) {
      const [olderId] = sorted[i - 1];
      const [newerId, newer] = sorted[i];
      if (Math.abs(hoursBetween(createdAt[olderId], createdAt[newerId])) > 24) continue;
      pairs.push({ keep: olderId, close: newerId, title: newer.name });
    }
  }

  return pairs;
}

export function duplicateRecord(pair: DuplicatePair): ActionRecord {
  return {
    action: `Flagged a possible duplicate: "${pair.title}" appears twice, created within 24h of each other`,
    page_id: pair.close,
    reversal: `Nothing was changed — this is a flag only. The board has no closed state, so §7's "if in doubt, flag, don't close" applies.`,
  };
}

/* -------------------------------------------------------------------------- */
/* T4 — file a bug                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One ticket per distinct cause, per §7.
 *
 * "Distinct cause" is the key, and the key is what stops this filing the same
 * bug every hour: an idle factory is one cause however many runs observe it,
 * and an unknown Status value is one cause per value. The caller checks the key
 * against bugs already filed before filing.
 */
export interface BugToFile {
  key: string;
  title: string;
  body: string;
}

export function bugsToFile(previous: Snapshot | null, current: Snapshot): BugToFile[] {
  const out: BugToFile[] = [];
  const h0 = previous?.notion_health;
  const h1 = current.notion_health;

  if (h1.null_title_rows > (h0?.null_title_rows ?? 0)) {
    out.push({
      key: "null-title-rows",
      title: "[supervisor] Notion board has rows with no title",
      body:
        `${h1.null_title_rows} row(s) in the roadmap/bugs databases have an empty Name.\n\n` +
        "A blank row took the poller down in August. The snapshot counts them rather than " +
        "throwing on them, so the factory keeps running, but the rows still need a title or deleting.",
    });
  }

  for (const value of h1.unknown_status_values) {
    if (h0?.unknown_status_values.includes(value)) continue;
    out.push({
      key: `unknown-status:${value}`,
      title: `[supervisor] Unknown Status value on the board: "${value}"`,
      body:
        `A ticket carries the Status "${value}", which is not one of the seven values the factory writes.\n\n` +
        "Nothing reads it, so the ticket is invisible to the poller and to every threshold in the " +
        "supervisor's staleness table. Either correct the row or add the value to " +
        "`scripts/supervisor/config.ts`.",
    });
  }

  for (const value of h1.unknown_module_values) {
    if (h0?.unknown_module_values.includes(value)) continue;
    out.push({
      key: `unknown-module:${value}`,
      title: `[supervisor] Unknown Module value on the board: "${value}"`,
      body:
        `A ticket carries the Module "${value}", which is not a known module.\n\n` +
        "A typo'd module silently creates a bucket nothing looks at. Either correct the row or add " +
        "the value to `KNOWN_MODULES` in `scripts/supervisor/config.ts`.",
    });
  }

  // Two consecutive runs, per §7 — one idle observation is a queue that happens
  // to be between items, and filing on it would file most nights.
  if (current.factory_idle && previous?.factory_idle) {
    out.push({
      key: "factory-idle",
      title: "[supervisor] Factory idle: items queued, nothing in progress",
      body:
        "Something has been `Ready for factory` for over two hours with nothing `In factory`, " +
        "across two consecutive supervisor runs.\n\n" +
        "That is the poller's failure signature. Check `factory-poll-notion.yml`'s most recent runs.",
    });
  }

  return out;
}

export function bugRecord(bug: BugToFile, issueUrl: string): ActionRecord {
  return {
    action: `Filed ${bug.title} — ${issueUrl}`,
    page_id: null,
    reversal: `Close ${issueUrl} as not planned.`,
  };
}
