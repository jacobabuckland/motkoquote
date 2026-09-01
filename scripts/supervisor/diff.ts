/**
 * S2's runner: read two snapshots, write the change events.
 *
 *   npx tsx scripts/supervisor/diff.ts --previous prev.json --current cur.json \
 *     --out events.json
 *
 * Exits 0 with an empty array when there is nothing. The workflow gates the
 * model step on the count this prints, which is what makes D8 structural rather
 * than a thing the prompt asks the model not to do.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { computeEvents, idempotencyKey } from "./diff-core";
import { isDiffable } from "./snapshot-core";
import type { Snapshot } from "./types";

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

function main(): void {
  const currentPath = arg("current");
  if (!currentPath) throw new Error("--current is required");

  const current = read(currentPath);
  if (!current) throw new Error(`Could not read the current snapshot at ${currentPath}`);

  const previousRaw = read(arg("previous"));
  // A partial snapshot is not a baseline. Diffing against one reports every
  // ticket it failed to read as having vanished.
  const previous = isDiffable(previousRaw) ? previousRaw : null;

  const events = computeEvents(previous, current);
  const out = arg("out") ?? "supervisor-events.json";

  writeFileSync(
    out,
    `${JSON.stringify({ key: idempotencyKey(previous), events }, null, 2)}\n`,
  );

  // Read by the workflow to gate the model step.
  const gh = process.env.GITHUB_OUTPUT;
  if (gh) {
    appendFileSync(gh, `count=${events.length}\nkey=${idempotencyKey(previous)}\n`);
  }

  console.log(`${events.length} change event(s)`);
  for (const e of events) {
    console.log(`  ${e.kind}${e.name ? ` — ${e.name}` : ""}${e.detail ? ` (${e.detail})` : ""}`);
  }
}

main();
