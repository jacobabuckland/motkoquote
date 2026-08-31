/**
 * S3 — write the hourly digest to the Factory Supervisor page.
 *
 *   npx tsx scripts/supervisor/publish.ts --digest digest.md \
 *     --snapshot current.json --events events.json [--actions actions.json]
 *
 * Replaces the `Latest` section wholesale and appends one run-log line (§8).
 * The page mechanics are in `page.ts`; this file is the digest's own rules —
 * the redaction, the line cap, and the refusal to publish nothing.
 *
 * Silent runs never reach this script: the workflow gates on the event count.
 * Being invoked with zero events therefore means the gate is broken, which is
 * D8, and it says so rather than writing an empty digest.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { SECTION_TITLES, appendRunLog, children, replaceSection, resolvePage } from "./page";
import { capDigest, redact, runLogLine } from "./publish-core";
import type { ActionRecord, ChangeEvent, Snapshot } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const snapshotPath = arg("snapshot");
  if (!snapshotPath) throw new Error("--snapshot is required");

  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  const { events } = JSON.parse(readFileSync(arg("events") ?? "", "utf8")) as {
    events: ChangeEvent[];
  };

  if (events.length === 0) {
    throw new Error(
      "publish.ts was invoked with zero change events. Silent runs must not reach this script — " +
        "the workflow's gate on the event count is broken (D8).",
    );
  }

  const actionsPath = arg("actions");
  let actions: ActionRecord[] = [];
  if (actionsPath) {
    try {
      actions = JSON.parse(readFileSync(actionsPath, "utf8")) as ActionRecord[];
    } catch {
      // The actions step is skipped on a dry run and on a run with no events
      // that reach it. An absent file means no actions, not a failure.
      actions = [];
    }
  }

  // Redact BEFORE the cap, so a redaction can never be what pushes a line past
  // the limit and gets it truncated back into legibility.
  const digest = capDigest(redact(readFileSync(arg("digest") ?? "", "utf8").trim()));

  const pageId = await resolvePage(snapshot.supervisor_page_id);
  const blocks = await children(pageId);

  await replaceSection(
    pageId,
    blocks,
    SECTION_TITLES.latest,
    `${SECTION_TITLES.latest} ${snapshot.taken_at}`,
    digest,
  );
  await appendRunLog(pageId, runLogLine(snapshot.taken_at, events.length, actions.length));

  // Record the page id back into the snapshot so the next run resolves it in
  // one step, and §11's "record the page ID here" has an answer.
  snapshot.supervisor_page_id = pageId;
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(`Published ${events.length} event(s) to Notion page ${pageId}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
