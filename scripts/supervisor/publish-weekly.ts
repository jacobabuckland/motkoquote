/**
 * M1 + R2 — publish the weekly metrics and retro, and file the retro's findings.
 *
 *   npx tsx scripts/supervisor/publish-weekly.ts --snapshot current.json \
 *     --metrics metrics.md --retro retro.md --findings findings.json [--dry-run]
 *
 * Runs independently of the hourly digest's gate. §R2's acceptance criterion is
 * that "a retro with no findings files nothing and writes one run-log line" —
 * so a quiet week still writes the metrics section and one log line, and only
 * the FINDINGS are conditional. That is the one place the supervisor speaks on
 * a run with no change events, and it is deliberate: a weekly section that goes
 * missing on a quiet week is indistinguishable from a retro that has broken.
 *
 * Findings are filed as `Needs spec` Roadmap tickets with the routing in the
 * title, per §R2. Filing is what makes a finding real — a retro that only
 * writes prose onto a page is a signal terminating in telemetry, which AGENTS.md
 * names as a failure in its own right.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { ROADMAP_DB_ID } from "./config";
import { notion } from "./notion";
import { SECTION_TITLES, appendRunLog, children, replaceSection, resolvePage } from "./page";
import { redact } from "./publish-core";
import type { Snapshot } from "./types";

const DRY_RUN = process.argv.includes("--dry-run");

interface FiledFinding {
  pattern: string;
  route: string;
  citations: string[];
  title: string;
  why_not_other_routes?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readText(path: string | undefined): string {
  if (!path) return "";
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function readFindings(path: string | undefined): FiledFinding[] {
  if (!path) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FiledFinding[];
  } catch {
    return [];
  }
}

/**
 * Titles already on the Roadmap, so a finding that recurs week after week is
 * filed once rather than every Monday.
 *
 * A pattern persisting is real information, but it belongs in the existing
 * ticket, not in a fourth copy of it. Three duplicate rows is also exactly the
 * state T3 exists to flag, and the supervisor generating that state itself
 * would be absurd.
 */
async function existingTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const page = await notion<{
      results: { properties: Record<string, { title?: { plain_text?: string }[] }> }[];
      has_more: boolean;
      next_cursor: string | null;
    }>(`databases/${ROADMAP_DB_ID}/query`, { method: "POST", body: JSON.stringify(body) });

    for (const row of page.results ?? []) {
      const text = (row.properties?.Name?.title ?? []).map((t) => t.plain_text ?? "").join("").trim();
      if (text) titles.add(text);
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
  } while (cursor);

  return titles;
}

async function fileFinding(finding: FiledFinding): Promise<void> {
  const body = [
    `Pattern: ${finding.pattern}`,
    `Routing: ${finding.route}`,
    "",
    `Cited outcomes (${finding.citations.length}): ${finding.citations.join(", ")}`,
    ...(finding.why_not_other_routes
      ? ["", `Why not the other four routes: ${finding.why_not_other_routes}`]
      : []),
    "",
    "Filed by the factory supervisor's weekly retro. Each cited id resolves to a concrete artefact",
    "in the outcome dataset — a revert SHA, a bug ticket, a QA rejection, or a halt.",
  ].join("\n");

  await notion("pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: ROADMAP_DB_ID },
      properties: {
        Name: { title: [{ type: "text", text: { content: finding.title.slice(0, 200) } }] },
        Status: { select: { name: "Needs spec" } },
        Module: { select: { name: "factory" } },
      },
      children: body.split("\n\n").map((paragraph) => ({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: paragraph.slice(0, 1900) } }] },
      })),
    }),
  });
}

async function main(): Promise<void> {
  const snapshotPath = arg("snapshot");
  if (!snapshotPath) throw new Error("--snapshot is required");
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const metrics = redact(readText(arg("metrics")));
  const retro = redact(readText(arg("retro")));
  const findings = readFindings(arg("findings"));

  if (DRY_RUN) {
    console.log(`[dry run] would publish metrics (${metrics.length} chars), retro (${retro.length} chars)`);
    console.log(`[dry run] would file ${findings.length} finding(s): ${findings.map((f) => f.title).join("; ")}`);
    return;
  }

  const pageId = await resolvePage(snapshot.supervisor_page_id);
  const blocks = await children(pageId);

  if (metrics) {
    await replaceSection(pageId, blocks, SECTION_TITLES.metrics, SECTION_TITLES.metrics, metrics);
  }
  if (retro) {
    // Re-read: replacing the metrics section changed the page's block ids, and
    // a stale list would delete blocks that have moved. Cheap, and the
    // alternative is a section boundary computed from a page that no longer
    // exists.
    const fresh = await children(pageId);
    await replaceSection(pageId, fresh, SECTION_TITLES.retro, SECTION_TITLES.retro, retro);
  }

  let filed = 0;
  if (findings.length > 0) {
    const existing = await existingTitles();
    for (const finding of findings) {
      if (existing.has(finding.title)) {
        console.log(`Already on the roadmap, not re-filing: ${finding.title}`);
        continue;
      }
      await fileFinding(finding);
      filed++;
    }
  }

  await appendRunLog(pageId, `${snapshot.taken_at} · weekly retro · ${filed} finding(s) filed`);

  snapshot.supervisor_page_id = pageId;
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(`Published the weekly sections to ${pageId}; filed ${filed} finding(s).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
