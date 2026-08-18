// Acceptance-test immutability, with a narrow carve-out for standing
// registries.
//
// The rule this enforces is unchanged: acceptance tests are the contract the
// implementation is judged against, so an Engineer that can rewrite them can
// retire any finding by editing what it is measured by. Every commit after the
// branch's first that touches tests/acceptance/ is a violation.
//
// The one exception is a standing REGISTRY — a file that is not this ticket's
// acceptance test but a long-lived inventory with an intended registration
// path, such as the public-API-route list in tests/acceptance/99.test.ts.
// Adding an entry to one is registration, not repair (see AGENTS.md). Without
// this carve-out, legitimately adding a public route to the registry is
// unblockable: registering it trips the guard, and NOT registering it is worse,
// because a route that stops being seen is worse than one that fails the check.
//
// The carve-out is deliberately as small as it can be:
//   - Registry files are named explicitly. A new one is a decision, never an
//     accident of matching a pattern.
//   - Only PURELY ADDITIVE changes qualify. A single deleted line is a
//     violation, so entries cannot be quietly removed from a security registry.
//   - Every added line must itself be an entry or a comment. Adding code, an
//     assertion, or anything else to a registry file is a violation, so the
//     carve-out cannot be used to weaken the checks the file performs.
//
// In short: you may add a row to the inventory. You may not touch the machinery
// that reads it.

import { execFileSync } from "node:child_process";

/**
 * Files under tests/acceptance/ that are standing registries rather than a
 * ticket's frozen acceptance test.
 *
 * Adding to this list widens what may be edited mid-branch, so it is a
 * deliberate, reviewable decision — not something a glob should decide.
 */
export const REGISTRY_FILES = ["tests/acceptance/99.test.ts"] as const;

export type RegistryVerdict =
  | { kind: "registration" }
  | { kind: "violation"; reason: string };

// A registry entry: a bare quoted string on its own line, optionally followed
// by a comma. `"/api/guest/realtime-session",` qualifies; anything carrying
// code, an operator or a call does not.
const ENTRY_LINE = /^\s*(["'`])[^"'`]*\1,?\s*$/;
const COMMENT_LINE = /^\s*\/\/.*$/;
const BLANK_LINE = /^\s*$/;

/**
 * Decides whether one file's unified diff is a registration (allowed) or a
 * modification (a violation).
 *
 * Pure so it can be tested directly — a guard whose rule cannot be exercised in
 * a test is a guard nobody can trust.
 */
export const classifyRegistryDiff = (patch: string): RegistryVerdict => {
  const lines = patch.split("\n");
  const added: string[] = [];
  let removed = 0;
  let sawHunk = false;

  for (const line of lines) {
    // Diff preamble. `---`/`+++` are file headers and must not be mistaken for
    // a removed/added line, so they are skipped before the +/- checks below.
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode")
    ) {
      continue;
    }

    if (line.startsWith("@@")) {
      sawHunk = true;
      continue;
    }

    if (!sawHunk) continue;

    if (line.startsWith("-")) {
      removed += 1;
      continue;
    }
    if (line.startsWith("+")) {
      added.push(line.slice(1));
      continue;
    }
    // Context line or "\ No newline at end of file" — carries no change.
  }

  if (removed > 0) {
    return {
      kind: "violation",
      reason:
        `removes ${removed} line(s). A registry may be added to, never edited — ` +
        "removing an entry takes something out of the check's view, which is the " +
        "failure this guard exists to catch.",
    };
  }

  if (added.length === 0) {
    return {
      kind: "violation",
      reason: "changes the file without adding a registry entry.",
    };
  }

  const notAnEntry = added.filter(
    (line) => !ENTRY_LINE.test(line) && !COMMENT_LINE.test(line) && !BLANK_LINE.test(line),
  );

  if (notAnEntry.length > 0) {
    return {
      kind: "violation",
      reason:
        "adds lines that are not registry entries or comments, so it is changing " +
        `what the file checks rather than what it lists:\n${notAnEntry
          .map((line) => `        +${line}`)
          .join("\n")}`,
    };
  }

  return { kind: "registration" };
};

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export type Violation = { sha: string; file: string; reason: string };

export type CheckResult = {
  violations: Violation[];
  registrations: { sha: string; file: string }[];
};

/**
 * Walks every commit after the branch's first and reports what, if anything,
 * touched tests/acceptance/ illegitimately.
 */
export const checkAcceptanceImmutability = (baseRef: string): CheckResult => {
  const commits = git(["rev-list", "--reverse", `${baseRef}..HEAD`])
    .split("\n")
    .map((sha) => sha.trim())
    .filter(Boolean);

  const violations: Violation[] = [];
  const registrations: { sha: string; file: string }[] = [];

  // The first commit is the PM's spec commit: it is allowed to write the
  // acceptance tests. Everything after it is under scrutiny.
  for (const sha of commits.slice(1)) {
    const files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file.startsWith("tests/acceptance/"));

    for (const file of files) {
      if (!(REGISTRY_FILES as readonly string[]).includes(file)) {
        violations.push({
          sha,
          file,
          reason:
            "is a frozen acceptance test. It is the contract this work is judged " +
            "against, so it may only be written in the spec commit.",
        });
        continue;
      }

      const patch = git(["show", "--format=", "--patch", sha, "--", file]);
      const verdict = classifyRegistryDiff(patch);
      if (verdict.kind === "registration") {
        registrations.push({ sha, file });
      } else {
        violations.push({ sha, file, reason: verdict.reason });
      }
    }
  }

  return { violations, registrations };
};

const main = (): void => {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error("usage: acceptance-immutability.ts <base-ref>");
    process.exit(2);
  }

  const { violations, registrations } = checkAcceptanceImmutability(baseRef);

  for (const { sha, file } of registrations) {
    // Surfaced, never silent: registering an entry in a security registry is a
    // DECISION NEEDED-equivalent notice, so a human sees the surface being
    // added even though the build goes green.
    console.log(`::notice::Registry entry added to ${file} in ${sha.slice(0, 8)}.`);
    console.log(
      `  Registration, not repair — allowed. A human should confirm the entry is ` +
        `correct: it records something the registry exists to keep in view.`,
    );
  }

  if (violations.length > 0) {
    console.log("::error::Acceptance tests were modified after the spec commit.");
    for (const { sha, file, reason } of violations) {
      console.log(`--- ${sha.slice(0, 8)} ${file} ---`);
      console.log(`  ${reason}`);
    }
    process.exit(1);
  }

  console.log(
    registrations.length > 0
      ? "Acceptance tests unmodified since the spec commit (registry additions only)."
      : "Acceptance tests unmodified since the spec commit.",
  );
};

// Only run when executed directly, so importing this for tests does not fire
// the check (and its process.exit) as a side effect.
if (process.argv[1]?.endsWith("acceptance-immutability.ts")) {
  main();
}
