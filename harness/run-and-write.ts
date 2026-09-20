#!/usr/bin/env tsx

/**
 * Canonical last step of every GPT voice-harness run.
 *
 * Scoring is prompt-driven (GPT talks to motko.app per GPT_HARNESS.md) — there
 * is no Node scorer. After a schema-valid result JSON exists, this script is
 * the only allowed way to end the run: it always invokes write-result.ts.
 *
 *   npm run harness:run-and-write -- /path/to/scored.json
 *   npx tsx harness/run-and-write.ts /path/to/scored.json
 *   cat scored.json | npx tsx harness/run-and-write.ts
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runCli } from "./write-result";

export const RUN_AND_WRITE_COMMAND = "npm run harness:run-and-write --";

export const END_OF_RUN_LINE =
  "END OF RUN  writer invoked. Do not hand-edit NEXT_FIX.md or paste over results/.";

function printEndOfRunUsage(): void {
  process.stderr.write(`Canonical last step of a GPT voice-harness run.

A scored run is incomplete until this command exits 0. It validates the
result JSON and always writes through harness/write-result.ts (results/,
NEXT_FIX.md, BACKLOG.md, RETEST_PROMPT.md, LESSONS.md).

  ${RUN_AND_WRITE_COMMAND} <scored.json>
  npx tsx harness/run-and-write.ts <scored.json>
  cat scored.json | npx tsx harness/run-and-write.ts

Do not drop a device-local file and stop. Do not write harness/results/
by hand. Do not point this at harness/results/example-result.json on the
live tree.

Same flags as write-result.ts (--harness-root, stdin via -).
See harness/GPT_HARNESS.md and harness/WIRING.md.
`);
}

function argvHasInput(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-" || arg === "--stdin") return true;
    if (arg === "--harness-root") {
      i += 1;
      continue;
    }
    if (!arg.startsWith("-")) return true;
  }
  return false;
}

export async function runAndWrite(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printEndOfRunUsage();
    return 0;
  }

  if (!argvHasInput(argv) && process.stdin.isTTY) {
    process.stderr.write(
      "A scored GPT voice run is INCOMPLETE until this command succeeds.\n\n",
    );
    printEndOfRunUsage();
    return 1;
  }

  const code = await runCli(argv);
  if (code === 0) {
    process.stdout.write(`${END_OF_RUN_LINE}\n`);
  }
  return code;
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  : false;

if (invokedDirectly) {
  runAndWrite().then((code) => {
    process.exitCode = code;
  });
}
