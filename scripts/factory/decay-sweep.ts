/**
 * Detect frozen-contract decay across every open factory branch at once.
 *
 *   npx tsx scripts/factory/decay-sweep.ts [--base main] [--limit N]
 *
 * WHY. Freezing the spec and the acceptance tests is what makes agent review
 * mean anything: an implementation that can edit its own contract can retire any
 * finding. But a frozen contract sits against a moving `main`, and every merge
 * to `main` can invalidate an assertion on a branch that has not moved at all.
 * The branch's own CI cannot see it — it reviews against the merge base — so
 * decay surfaces one branch at a time, at the moment somebody tries to merge,
 * each one costing a cycle to rediscover.
 *
 * The answer is not to unfreeze the contracts. It is to find the decay in
 * batches, early: when `main` moves, merge it into every open factory branch and
 * run each branch's own acceptance test and typecheck against the result. Seven
 * broken assertions in one report can be repaired in a sitting; seven discovered
 * over two days cost a cycle each.
 *
 * This does not modify any branch. It merges in a scratch worktree and reports.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

export type DecayKind =
  | "ok"
  | "merge-conflict"
  | "typecheck"
  | "acceptance-failure"
  | "no-merge-base"
  | "no-acceptance-test";

export interface BranchDecay {
  branch: string;
  issue: string;
  kind: DecayKind;
  /** The specific broken assertions or errors, already trimmed for a comment. */
  details: string[];
}

const KIND_TITLES: Record<DecayKind, string> = {
  ok: "Green against current main",
  "merge-conflict": "Will not merge with main",
  typecheck: "Typecheck broken by main",
  "acceptance-failure": "Acceptance assertions broken by main",
  "no-merge-base": "No merge base with main",
  "no-acceptance-test": "No acceptance test to run",
};

/**
 * The order decay is reported in: what blocks a merge outright first, then what
 * fails the gate, then the branches that are fine.
 */
const KIND_ORDER: DecayKind[] = [
  "no-merge-base",
  "merge-conflict",
  "typecheck",
  "acceptance-failure",
  "no-acceptance-test",
  "ok",
];

export function renderDecayReport(results: BranchDecay[], base: string): string {
  const broken = results.filter((r) => r.kind !== "ok");
  const lines: string[] = [];

  lines.push(`## Frozen-contract decay — ${results.length} open factory branch(es) against \`${base}\``);
  lines.push("");

  if (broken.length === 0) {
    lines.push(
      `Every open factory branch still passes its own acceptance test and typecheck when merged with \`${base}\`. Nothing has decayed.`,
    );
    lines.push("");
    lines.push(
      "_A branch's own CI reviews against its merge base, so it cannot see this. That is why the sweep runs whenever `main` moves rather than waiting for someone to merge._",
    );
    return lines.join("\n");
  }

  lines.push(
    `**${broken.length} of ${results.length} branch(es) no longer pass against \`${base}\`.** None of them has changed — \`${base}\` moved underneath them. Repairing these together is the point of the sweep: each one found separately costs a cycle to rediscover.`,
  );
  lines.push("");

  for (const kind of KIND_ORDER) {
    if (kind === "ok") continue;
    const group = broken.filter((r) => r.kind === kind);
    if (group.length === 0) continue;

    lines.push(`### ${KIND_TITLES[kind]}`);
    lines.push("");
    for (const r of group) {
      lines.push(`**#${r.issue}** — \`${r.branch}\``);
      lines.push("");
      if (r.details.length > 0) {
        lines.push("```");
        lines.push(...r.details);
        lines.push("```");
      } else {
        lines.push("_No detail captured._");
      }
      lines.push("");
    }
  }

  const green = results.filter((r) => r.kind === "ok");
  if (green.length > 0) {
    lines.push(`### Still green`);
    lines.push("");
    lines.push(green.map((r) => `\`${r.branch}\``).join(", "));
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "_Frozen files may only be corrected in a branch's FIRST commit, so these are repaired by hand rather than by re-running an agent — the Engineer cannot reach them. Nothing here has been modified: the sweep merges in a scratch worktree and reports._",
  );
  return lines.join("\n");
}

/** Keep a failure excerpt small enough to read in a comment. */
export function trimDetails(raw: string, max = 12): string[] {
  return raw
    .split("\n")
    .map((l) => l.replace(/\[[0-9;]*m/g, "").trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(0, max)
    .map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l));
}

/** Assertion failures and type errors, preferred over incidental output. */
export function extractFailures(output: string): string[] {
  const interesting = output
    .split("\n")
    .map((l) => l.replace(/\[[0-9;]*m/g, "").trimEnd())
    .filter(
      (l) =>
        /^\s*(FAIL|AssertionError|TypeError|ReferenceError|SyntaxError|Error:)/.test(l) ||
        /error TS\d+:/.test(l) ||
        /^\s*→/.test(l),
    );
  return interesting.length > 0 ? trimDetails(interesting.join("\n")) : [];
}

// ---------------------------------------------------------------------- runtime

function git(args: string[], cwd?: string): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", cwd, maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return "";
  }
}

function run(cmd: string, args: string[], cwd: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, {
      encoding: "utf8",
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}\n${e.stderr ?? ""}` };
  }
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function sweep(): void {
  const base = `origin/${arg("base", "main")}`;
  const limit = Number(arg("limit", "50"));
  const root = process.cwd();

  git(["fetch", "--quiet", "origin", "+refs/heads/factory/*:refs/remotes/origin/factory/*"]);
  git(["fetch", "--quiet", "origin", base.replace("origin/", "")]);

  const branches = git(["branch", "-r", "--no-merged", base, "--list", "origin/factory/*"])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, limit);

  const results: BranchDecay[] = [];

  for (const ref of branches) {
    const branch = ref.replace(/^origin\//, "");
    const issue = branch.replace("factory/", "");
    const dir = `${root}/.decay-sweep/${issue}`;

    if (git(["merge-base", base, ref]).trim() === "") {
      results.push({
        branch,
        issue,
        kind: "no-merge-base",
        details: [
          `${branch} has no merge base with ${base}.`,
          "Unrelated history — this branch cannot be merged at all, whatever its tests say.",
        ],
      });
      continue;
    }

    git(["worktree", "add", "-f", "--detach", dir, ref]);
    // The merge is what this sweep is FOR: the question is not whether the
    // branch passes, but whether it still passes once main is under it.
    const merge = run("git", ["-c", "user.email=sweep@motko.local", "-c", "user.name=decay-sweep", "merge", base, "--no-edit"], dir);
    if (!merge.ok) {
      results.push({
        branch,
        issue,
        kind: "merge-conflict",
        details: trimDetails(merge.output),
      });
      git(["worktree", "remove", "--force", dir]);
      continue;
    }

    // node_modules is shared rather than installed per branch: the sweep would
    // otherwise spend most of its time on npm ci, and a branch whose lockfile
    // differs from main's is a different report than contract decay.
    run("ln", ["-sfn", `${root}/node_modules`, `${dir}/node_modules`], root);

    const testPath = [`tests/acceptance/${issue}.test.ts`, `tests/acceptance/${issue}.test.tsx`].find(
      (p) => existsSync(`${dir}/${p}`),
    );

    const tsc = run("npx", ["tsc", "--noEmit"], dir);
    if (!tsc.ok) {
      results.push({
        branch,
        issue,
        kind: "typecheck",
        details: extractFailures(tsc.output),
      });
      git(["worktree", "remove", "--force", dir]);
      continue;
    }

    if (!testPath) {
      results.push({
        branch,
        issue,
        kind: "no-acceptance-test",
        details: [`No tests/acceptance/${issue}.test.ts or .tsx on this branch.`],
      });
      git(["worktree", "remove", "--force", dir]);
      continue;
    }

    const vitest = run("npx", ["vitest", "run", testPath], dir);
    results.push(
      vitest.ok
        ? { branch, issue, kind: "ok", details: [] }
        : { branch, issue, kind: "acceptance-failure", details: extractFailures(vitest.output) },
    );
    git(["worktree", "remove", "--force", dir]);
  }

  const report = renderDecayReport(results, base.replace("origin/", ""));
  console.log(report);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }
  // Written to a file rather than posted here: the workflow decides where the
  // report goes, and a sweep that fails to post must still leave its findings
  // somewhere readable.
  if (process.env.DECAY_REPORT_PATH) {
    writeFileSync(process.env.DECAY_REPORT_PATH, `${report}\n`);
  }
}

if (process.argv[1]?.endsWith("decay-sweep.ts")) sweep();
