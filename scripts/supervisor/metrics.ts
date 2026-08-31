/**
 * M1 — the weekly metrics baseline.
 *
 * RUNNABLE: npx tsx scripts/supervisor/metrics.ts --outcomes outcomes.json --snapshots supervisor/history --out metrics.md
 *
 * Computed from the `factory-state` snapshot history plus R1's outcome rows.
 * Published as a fixed section at the foot of the supervisor page, replaced
 * weekly.
 *
 * Every metric here is a RATE OR A MEDIAN OVER OBSERVED ARTEFACTS, and each one
 * reports its denominator. A rate with the denominator hidden is the shape that
 * lets "QA rejected 2 of 3 items this week" read as a crisis; printing `2/3`
 * makes the sample size visible at the point of reading, which is the only
 * place it helps.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Outcome } from "./outcomes";
import type { Snapshot } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** `n/d` as a percentage, or "—" when there is nothing to divide. */
export function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "— (no items)";
  return `${Math.round((numerator / denominator) * 100)}% (${numerator}/${denominator})`;
}

export interface Metrics {
  scoping_no_halt: string;
  qa_rejection_rate: string;
  revert_rate: string;
  qa_escape_rate: string;
  median_ready_to_previewed_hours: number | null;
  halts_opened: number;
  halts_closed: number;
  median_halt_hours: number | null;
}

/**
 * Median hours from `Ready for factory` to `Previewed`, over the snapshot
 * history.
 *
 * Reconstructed by walking the snapshots in order and recording, per ticket,
 * when it was first seen in each state. A ticket that entered `Ready for
 * factory` before the history begins is skipped rather than dated from the
 * first snapshot — that would clamp its duration to the history's length and
 * bias the median downwards exactly on the slowest items, which are the ones
 * the metric exists to reveal.
 */
export function medianReadyToPreviewed(history: Snapshot[]): number | null {
  const enteredReady = new Map<string, string>();
  const durations: number[] = [];
  const seen = new Set<string>();

  for (const [index, snap] of history.entries()) {
    for (const [pageId, ticket] of Object.entries(snap.tickets)) {
      const first = !seen.has(pageId);
      seen.add(pageId);

      if (ticket.status === "Ready for factory") {
        // Only date it if we watched it arrive: either it is genuinely new to
        // the history, or the previous snapshot had it in another state.
        const previous = index > 0 ? history[index - 1].tickets[pageId] : undefined;
        const arrived = previous ? previous.status !== "Ready for factory" : !first || index === 0;
        if (arrived && !enteredReady.has(pageId)) enteredReady.set(pageId, snap.taken_at);
      }

      if (ticket.status === "Previewed" && enteredReady.has(pageId)) {
        const from = enteredReady.get(pageId)!;
        durations.push((Date.parse(snap.taken_at) - Date.parse(from)) / 3_600_000);
        enteredReady.delete(pageId);
      }
    }
  }

  const value = median(durations);
  return value === null ? null : Math.round(value * 10) / 10;
}

export function computeMetrics(history: Snapshot[], outcomes: Outcome[]): Metrics {
  const latest = history[history.length - 1];

  // Denominator for the agent rates: items that reached the factory at all
  // during the window. A backlog item nothing touched says nothing about how
  // well scoping or engineering did.
  const touched = new Set<string>();
  for (const snap of history) {
    for (const [pageId, t] of Object.entries(snap.tickets)) {
      if (["In factory", "Previewed", "Shipped", "Blocked"].includes(t.status)) touched.add(pageId);
    }
  }
  const denominator = touched.size;

  const haltedTickets = new Set(
    outcomes.filter((o) => o.type === "halt").map((o) => o.ticket).filter(Boolean) as string[],
  );
  const rejectedTickets = new Set(
    outcomes.filter((o) => o.type === "qa_rejection").map((o) => o.ticket).filter(Boolean) as string[],
  );

  // A halt is keyed by issue number and `touched` by Notion page id, so map
  // through the latest snapshot rather than comparing the two directly.
  const issuesTouched = new Set(
    [...touched].map((id) => latest?.tickets[id]?.issue).filter((n): n is number => n !== null && n !== undefined),
  );
  const haltedAndTouched = [...issuesTouched].filter((n) => haltedTickets.has(String(n))).length;
  const rejectedAndTouched = [...issuesTouched].filter((n) => rejectedTickets.has(String(n))).length;

  const reverts = outcomes.filter((o) => o.type === "revert" || o.type === "fix_forward").length;
  const escapes = outcomes.filter((o) => o.type === "bug_linked_to_pr").length;

  const haltRows = outcomes.filter((o) => o.type === "halt");
  const closed = haltRows.filter((o) => /resolved after ([\d.]+)h/.test(o.detail));
  const haltHours = closed
    .map((o) => Number(o.detail.match(/resolved after ([\d.]+)h/)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n));

  return {
    scoping_no_halt: rate(denominator - haltedAndTouched, denominator),
    qa_rejection_rate: rate(rejectedAndTouched, denominator),
    revert_rate: rate(reverts, denominator),
    qa_escape_rate: rate(escapes, denominator),
    median_ready_to_previewed_hours: medianReadyToPreviewed(history),
    halts_opened: haltRows.length,
    halts_closed: closed.length,
    median_halt_hours: (() => {
      const m = median(haltHours);
      return m === null ? null : Math.round(m * 10) / 10;
    })(),
  };
}

export function renderMetrics(metrics: Metrics, window: string): string {
  const hours = (n: number | null) => (n === null ? "— (none completed in window)" : `${n}h`);

  return [
    `## Metrics — week to ${window}`,
    "",
    "### Scoping",
    `- Items completed without a halt: ${metrics.scoping_no_halt}`,
    "",
    "### Eng",
    `- QA rejection rate: ${metrics.qa_rejection_rate}`,
    `- 7-day revert / fix-forward rate: ${metrics.revert_rate}`,
    "",
    "### QA",
    `- Escape rate (production bugs whose introducing PR passed QA): ${metrics.qa_escape_rate}`,
    "",
    "### Factory",
    `- Median \`Ready for factory\` → \`Previewed\`: ${hours(metrics.median_ready_to_previewed_hours)}`,
    `- Halts opened: ${metrics.halts_opened} · closed: ${metrics.halts_closed} · median open: ${hours(metrics.median_halt_hours)}`,
  ].join("\n");
}

function loadHistory(dir: string): Snapshot[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  return files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8")) as Snapshot;
      } catch {
        return null;
      }
    })
    .filter((s): s is Snapshot => s !== null && s.partial !== true)
    .sort((a, b) => a.taken_at.localeCompare(b.taken_at));
}

function main(): void {
  const history = loadHistory(arg("snapshots") ?? "supervisor/history");
  if (history.length === 0) {
    throw new Error(
      "CAPABILITY FAULT: no snapshot history to compute metrics from. " +
        "Expected JSON snapshots under the --snapshots directory on the factory-state branch.",
    );
  }

  let outcomes: Outcome[] = [];
  const outcomesPath = arg("outcomes");
  if (outcomesPath) {
    try {
      outcomes = JSON.parse(readFileSync(outcomesPath, "utf8")) as Outcome[];
    } catch {
      outcomes = [];
    }
  }

  const window = history[history.length - 1].taken_at.slice(0, 10);
  const markdown = renderMetrics(computeMetrics(history, outcomes), window);

  writeFileSync(arg("out") ?? "supervisor-metrics.md", `${markdown}\n`);
  console.log(markdown);
}

if (process.argv[1]?.endsWith("metrics.ts")) {
  main();
}
