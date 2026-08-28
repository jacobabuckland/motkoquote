/**
 * What the CI gate actually said about a commit — and, just as importantly,
 * when it said nothing at all.
 *
 * WHY. The Engineer and QA both treated "conclusion is not success" as red.
 * A concurrency group cancels a superseded run the moment a newer commit lands,
 * which is its intended behaviour, so any branch that receives two pushes close
 * together produced a block reading:
 *
 *     CI is red on 59adc3a — not handing this to QA.
 *     Gate run concluded `cancelled`
 *
 * On #257 the gate was not red. Every check passed on the head that mattered.
 * The comment then correctly reported that it could not retrieve a failing log,
 * because there was no failing log — and the block still read as a real failure
 * to anyone skimming. That is intervention cost with no signal behind it, and
 * a misleading account of what happened.
 *
 * A cancellation is the ABSENCE of a verdict, not a negative one. The four
 * outcomes below say so explicitly, so a caller cannot collapse "we did not
 * hear" into "we heard no".
 *
 * Pure: runs, a sha and a branch head in, a verdict out. No network, so the
 * rule is exercised by tests rather than only in anger.
 */

/** Conclusions that are a real answer about the commit. */
const DECISIVE = ["success", "failure", "timed_out", "action_required", "neutral"];

/**
 * A cancelled run carries no information about the code. `skipped` likewise —
 * it is already handled upstream, and is listed here so this file cannot
 * quietly start reading it as a failure.
 */
const INDECISIVE = ["cancelled", "skipped", "stale"];

/**
 * @typedef {object} Run
 * @property {string} headSha
 * @property {string} status              queued | in_progress | completed
 * @property {string|null} conclusion
 * @property {number} [databaseId]
 */

/**
 * @typedef {(
 *   | { kind: "green",      run: Run }
 *   | { kind: "red",        run: Run, conclusion: string }
 *   | { kind: "pending" }
 *   | { kind: "superseded", head: string }
 *   | { kind: "no-verdict", run: Run|null, reason: string }
 * )} GateVerdict
 */

/**
 * Classify the gate for one commit.
 *
 * `runs` is `gh run list --json databaseId,headSha,status,conclusion`, newest
 * first — the order gh returns. `head` is the branch head read at evaluation
 * time, which is not always `sha`: #283 blocked an item by judging 59adc3a
 * while the branch had already moved to 1b923a1, so even a genuine failure on
 * 59adc3a would have been the wrong question to ask.
 *
 * @param {{ runs: Run[], sha: string, head?: string }} input
 * @returns {GateVerdict}
 */
export function classifyGate({ runs, sha, head }) {
  const forSha = (runs ?? []).filter((run) => run?.headSha === sha);
  const completed = forSha.filter((run) => run.status === "completed");

  // Newest decisive run wins. A re-run after a cancellation is the answer;
  // taking merely the newest would let the cancellation outrank it whenever
  // gh happens to list it first.
  const decisive = completed.find((run) => DECISIVE.includes(String(run.conclusion)));
  if (decisive) {
    return decisive.conclusion === "success"
      ? { kind: "green", run: decisive }
      : { kind: "red", run: decisive, conclusion: String(decisive.conclusion) };
  }

  // Still running, OR not created yet. Both are "keep waiting", and the second
  // is the one that matters: a caller polls immediately after pushing, when
  // GitHub has usually not created the run yet. Returning a verdict there would
  // block every item on the first poll — the caller's own timeout is what turns
  // a run that never arrives into a decision, and it already has a message for
  // that case.
  //
  // Checked before `superseded` only for runs that exist; an absent run on a
  // branch whose head has moved is still superseded, since nothing will arrive
  // for a commit nobody will merge.
  if (forSha.some((run) => run.status !== "completed")) return { kind: "pending" };
  if (forSha.length === 0 && !(head && head !== sha)) return { kind: "pending" };

  const cancelled = completed.find((run) => INDECISIVE.includes(String(run.conclusion)));

  // The branch moved on. Whatever this job was about to say is moot: a newer
  // commit has its own run, and blocking the item on a commit nobody is going
  // to merge is the exact false block #283 records. Waiting is equally wrong —
  // no run will ever arrive for a superseded sha.
  if (head && head !== sha) return { kind: "superseded", head };

  if (cancelled) {
    return {
      kind: "no-verdict",
      run: cancelled,
      reason:
        `the only completed run for this commit concluded \`${cancelled.conclusion}\`, ` +
        "which says nothing about the code. Nothing newer is queued and the branch " +
        "head has not moved, so this is a cancellation with no re-run behind it — " +
        "a manual cancel, or a reclaimed runner. Re-run the gate on this commit.",
    };
  }

  if (completed.length === 0) {
    // Only reachable when the head has moved on and nothing ran for this sha —
    // the superseded check above takes that case first, so this is a backstop.
    return { kind: "no-verdict", run: null, reason: "no CI run exists for this commit at all." };
  }

  // Completed, and its conclusion is in neither list. Refuse to guess: a
  // conclusion this file does not model is exactly the shape that produced the
  // defect above.
  return {
    kind: "no-verdict",
    run: completed[0],
    reason:
      `the run concluded \`${completed[0].conclusion}\`, which this check does not model. ` +
      "Teach scripts/factory/gate-verdict.mjs that conclusion rather than reading it as a verdict.",
  };
}

/**
 * CLI: gate-verdict.mjs <runs-json-file> <sha> [head]
 *
 * Always three lines, so a shell caller can read them positionally without
 * parsing JSON: the verdict kind, a human detail (empty for `green`), and the
 * run id it refers to (empty when there is no run).
 */
if (process.argv[1] && process.argv[1].endsWith("gate-verdict.mjs")) {
  const { readFileSync } = await import("node:fs");
  const [file, sha, head] = process.argv.slice(2);
  if (!file || !sha) {
    console.error("usage: gate-verdict.mjs <runs-json-file> <sha> [head]");
    process.exit(2);
  }

  const verdict = classifyGate({
    runs: JSON.parse(readFileSync(file, "utf8")),
    sha,
    head: head || undefined,
  });

  const detail =
    verdict.kind === "red"
      ? verdict.conclusion
      : verdict.kind === "no-verdict"
        ? verdict.reason
        : verdict.kind === "superseded"
          ? verdict.head
          : "";

  const runId = "run" in verdict && verdict.run ? String(verdict.run.databaseId ?? "") : "";

  console.log(verdict.kind);
  console.log(detail.replace(/\n/g, " "));
  console.log(runId);
}
