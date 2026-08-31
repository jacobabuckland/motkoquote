/**
 * S1 — take one snapshot of factory state and write it as JSON.
 *
 *   NOTION_API_KEY=… FACTORY_TOKEN=… npx tsx scripts/supervisor/snapshot.ts \
 *     --out /tmp/current.json [--previous /tmp/previous.json]
 *
 * Reads both Notion databases for the board's own view of each ticket (name,
 * status, module, preview URL), and GitHub for everything the factory actually
 * keeps there (halts, QA rejections, PR, preview deployment). The S0 record in
 * docs/supervisor/S0-checks.md says why that split exists.
 *
 * The previous snapshot is optional and is read for one purpose only: carrying
 * `status_since` forward for a ticket whose status has not changed and whose
 * label event has aged out of the event window. Nothing else about the previous
 * run influences what this one observes.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { BUGS_DB_ID, ROADMAP_DB_ID } from "./config";
import {
  countQaRejections,
  hasStoppedLabel,
  listFactoryIssues,
  listLabelEvents,
  mainStatus,
  normalisePageId,
  notionPageIdFromBody,
  prForIssue,
  previewStatus,
  statusSinceFromEvents,
  type Issue,
  type LabelEvent,
} from "./github";
import { NotionRateLimited, queryDatabase, readSelect, readTitle, readUrl } from "./notion";
import {
  computeFactoryIdle,
  computeHealth,
  crossedThresholds,
  resolveStatusSince,
} from "./snapshot-core";
import type { Db, Snapshot, TicketSnapshot } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readPrevious(path: string | undefined): Snapshot | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
  } catch {
    // A missing or unreadable previous snapshot is the FIRST RUN, which is
    // normal and must not fail. It is not the same as a corrupt one, but the
    // consequence is identical — every ticket is new and `status_since` starts
    // now — so they are handled the same way.
    return null;
  }
}

/**
 * Index issues by the Notion page they belong to.
 *
 * Both linkage directions are consulted (§4.5): the page's `GitHub Issue`
 * property, and the issue body's marker. This builds the body→page half; the
 * caller checks the property half and prefers whichever resolves, reporting
 * the ticket as unlinked only when neither does.
 */
function indexIssuesByPage(issues: Issue[]): Map<string, Issue> {
  const byPage = new Map<string, Issue>();
  for (const issue of issues) {
    const pageId = notionPageIdFromBody(issue.body);
    if (!pageId) continue;
    // Newest issue wins: a re-derived card can produce a second issue against
    // the same page, and the live one is the later.
    const existing = byPage.get(pageId);
    if (!existing || issue.number > existing.number) byPage.set(pageId, issue);
  }
  return byPage;
}

async function collectDb(
  dbId: string,
  db: Db,
  issues: Issue[],
  events: LabelEvent[],
  previous: Snapshot | null,
  takenAt: string,
): Promise<{
  tickets: Record<string, TicketSnapshot>;
  rows: { title: string | null; status: string | null; module: string | null }[];
  unlinked: number;
}> {
  const pages = await queryDatabase(dbId);
  const byPage = indexIssuesByPage(issues);
  const byNumber = new Map(issues.map((i) => [i.number, i]));

  const tickets: Record<string, TicketSnapshot> = {};
  const rows: { title: string | null; status: string | null; module: string | null }[] = [];
  let unlinked = 0;

  for (const page of pages) {
    const pageId = normalisePageId(page.id);
    const title = readTitle(page);
    const status = readSelect(page, "Status");
    const moduleName = readSelect(page, "Module");

    rows.push({ title, status, module: moduleName });

    // A null title is counted above and still snapshotted below. Dropping the
    // row would make the blank-row failure invisible again — the point is that
    // it is REPORTED, not that it is skipped.
    const issueUrl = readUrl(page, "GitHub Issue");
    const fromProperty = issueUrl ? Number(issueUrl.match(/\/issues\/(\d+)/)?.[1] ?? NaN) : NaN;
    const issue =
      (Number.isFinite(fromProperty) ? byNumber.get(fromProperty) : undefined) ?? byPage.get(pageId);

    if (!issue) unlinked++;

    const labels = issue?.labels ?? [];
    const previousTicket = previous?.tickets?.[pageId];

    const ticket: TicketSnapshot = {
      db,
      name: title ?? "(untitled)",
      status: status ?? "(unset)",
      module: moduleName ?? "unassigned",
      status_since: resolveStatusSince(
        issue ? statusSinceFromEvents(events, issue.number, issue.labels) : null,
        previousTicket,
        status ?? "(unset)",
        takenAt,
      ),
      issue: issue?.number ?? null,
      pr: null,
      preview_url: readUrl(page, "Preview URL"),
      preview_status: "unknown",
      // §4.2: a stopped label on an OPEN issue. A closed issue carrying a stale
      // stopped label is not a halt anyone is waiting on.
      halt_open: Boolean(issue) && issue!.state === "open" && hasStoppedLabel(labels),
      qa_rejections: issue ? countQaRejections(events, issue.number) : 0,
    };

    tickets[pageId] = ticket;
  }

  return { tickets, rows, unlinked };
}

/**
 * PR-derived fields, fetched only for tickets that can have them.
 *
 * A `Backlog` or `Shipped` ticket's preview status cannot change anything the
 * digest reports, and each lookup is two GitHub requests. Restricting the fetch
 * to live states keeps the hourly run inside a rate limit five other factory
 * workflows share.
 */
const LIVE_STATUSES = new Set(["In factory", "Previewed", "Blocked"]);

async function enrichFromGitHub(tickets: Record<string, TicketSnapshot>): Promise<void> {
  for (const ticket of Object.values(tickets)) {
    if (ticket.issue === null) continue;
    if (!LIVE_STATUSES.has(ticket.status)) continue;

    const branch = `factory/${ticket.issue}`;
    ticket.pr = await prForIssue(ticket.issue);
    ticket.preview_status = await previewStatus(branch);
  }
}

async function main(): Promise<void> {
  const takenAt = new Date().toISOString();
  const previous = readPrevious(arg("previous"));
  const out = arg("out") ?? "supervisor-snapshot.json";

  let snapshot: Snapshot;

  try {
    const [issues, events, main_] = await Promise.all([
      listFactoryIssues(),
      listLabelEvents(),
      mainStatus(),
    ]);

    const roadmap = await collectDb(ROADMAP_DB_ID, "roadmap", issues, events, previous, takenAt);
    const bugs = await collectDb(BUGS_DB_ID, "bugs", issues, events, previous, takenAt);

    const tickets = { ...roadmap.tickets, ...bugs.tickets };
    await enrichFromGitHub(tickets);

    const thresholds = Object.entries(tickets).flatMap(([id, t]) =>
      crossedThresholds(id, t, takenAt),
    );

    snapshot = {
      taken_at: takenAt,
      main: main_,
      tickets,
      thresholds_crossed: thresholds.sort(),
      notion_health: computeHealth(
        [...roadmap.rows, ...bugs.rows],
        roadmap.unlinked + bugs.unlinked,
      ),
      factory_idle: computeFactoryIdle(tickets, takenAt),
      supervisor_page_id: previous?.supervisor_page_id ?? null,
      preview_retries: previous?.preview_retries ?? {},
    };
  } catch (err) {
    // A rate limit is the one failure with a defined recovery: mark the
    // snapshot partial and let the workflow stop. `isDiffable` rejects it, so
    // no digest is emitted and — because the snapshot is committed LAST and
    // only after publish succeeds — the previous one stays current and the
    // next run diffs against it. A partial snapshot that got committed would
    // diff as mass change.
    if (err instanceof NotionRateLimited) {
      console.error(`::warning::${err.message}`);
      process.exit(75); // EX_TEMPFAIL — the workflow reads this as "skip".
    }
    throw err;
  }

  writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Snapshot: ${Object.keys(snapshot.tickets).length} tickets, main ${snapshot.main.ci}, ` +
      `${snapshot.thresholds_crossed.length} thresholds crossed, idle=${snapshot.factory_idle}`,
  );
}

if (process.argv[1]?.endsWith("snapshot.ts")) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
