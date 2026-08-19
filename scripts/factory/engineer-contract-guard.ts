// The Engineer's side of contract immutability.
//
// CI already enforces this rule on the pull request, carve-out and all, in
// scripts/ci/acceptance-immutability.ts. The Engineer workflow enforces it
// twice more and earlier: once against the working tree, and once by walking
// the commits the agent made for itself. Those two checks matched frozen paths
// with a bare `grep`, which meant they rejected the one edit AGENTS.md
// requires — registering a new API route in tests/acceptance/99.test.ts.
//
// On #257 that cost two complete, green implementations, discarded for doing
// what the instructions say to do. This routes all three enforcement points
// through one classifier so the rule cannot mean different things in different
// places, and so widening the carve-out is a single reviewable edit rather than
// three.
//
// Nothing here relaxes the freeze. classifyRegistryDiff is the CI module's own,
// and it is stricter than "additions only": a removed line is a violation, and
// every added line must itself be an entry or a comment, so the carve-out
// cannot be used to add an assertion or change the machinery that reads the
// list.
//
// Usage:
//   engineer-contract-guard.ts record <snapshot>
//   engineer-contract-guard.ts working-tree <snapshot> <base-sha>
//   engineer-contract-guard.ts commits <before-sha> <after-sha>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  REGISTRY_FILES,
  classifyRegistryDiff,
} from "../ci/acceptance-immutability";

const FROZEN_ROOTS = ["tests/acceptance", "docs/specs"];

const isRegistry = (file: string): boolean =>
  (REGISTRY_FILES as readonly string[]).includes(file);

const git = (args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
};

/**
 * Fingerprints every frozen file EXCEPT the registries, which are never the
 * thing that trips the byte-for-byte comparison — they are classified instead.
 */
const fingerprint = (): string =>
  FROZEN_ROOTS.flatMap((root) => walk(root))
    .filter((file) => !isRegistry(file))
    .sort()
    .map(
      (file) =>
        `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${file}`,
    )
    .join("\n");

/**
 * Registry entries added are reported, never passed over in silence.
 *
 * Written to stderr: `commits` mode's stdout is captured by the workflow as the
 * list of offending files, and a notice printed there would be read back as a
 * violation.
 */
const announce = (file: string, where: string): void => {
  console.error(`::notice::Registry entry added to ${file} ${where}.`);
  console.error(
    "  Registration, not repair — allowed. A human should confirm the entry is " +
      "correct: it records something the registry exists to keep in view.",
  );
};

const fail = (lines: string[]): never => {
  for (const line of lines) console.log(line);
  process.exit(1);
};

const main = (): void => {
  const [mode, a, b] = process.argv.slice(2);

  if (mode === "record") {
    if (!a) fail(["::error::record needs a snapshot path"]);
    writeFileSync(a!, fingerprint());
    console.log(fingerprint());
    return;
  }

  if (mode === "working-tree") {
    if (!a || !b) fail(["::error::working-tree needs a snapshot path and a base sha"]);

    if (readFileSync(a!, "utf8") !== fingerprint()) {
      fail([
        "::error::Engineer modified the spec or the acceptance tests. Neither is " +
          "writable by the Engineer: they are the contract this work is judged against.",
        git(["diff", "--stat", b!, "--", ...FROZEN_ROOTS]),
      ]);
    }

    for (const file of REGISTRY_FILES) {
      // Diffed against the recorded base rather than the working tree: the
      // agent can commit for itself, and a committed change leaves the working
      // tree clean while still having rewritten the file.
      const patch = git(["diff", b!, "--", file]);
      if (!patch.trim()) continue;

      const verdict = classifyRegistryDiff(patch);
      if (verdict.kind === "violation") {
        fail([`::error::${file} ${verdict.reason}`, patch]);
      }
      announce(file, "in this run");
    }

    console.log("Spec and acceptance tests unchanged.");
    return;
  }

  if (mode === "commits") {
    if (!a || !b) fail(["::error::commits needs a before sha and an after sha"]);

    const violations: string[] = [];

    for (const sha of git(["rev-list", `${a!}..${b!}`]).split("\n").filter(Boolean)) {
      const touched = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha])
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => FROZEN_ROOTS.some((root) => f.startsWith(`${root}/`)));

      for (const file of touched) {
        if (!isRegistry(file)) {
          violations.push(`${sha.slice(0, 8)} ${file}`);
          continue;
        }
        const verdict = classifyRegistryDiff(
          git(["show", "--format=", "--patch", sha, "--", file]),
        );
        if (verdict.kind === "violation") {
          violations.push(`${sha.slice(0, 8)} ${file} — ${verdict.reason}`);
        } else {
          announce(file, `in ${sha.slice(0, 8)}`);
        }
      }
    }

    // Printed to stdout for the workflow to capture and quote back on the
    // issue; an empty result means nothing offended.
    for (const violation of violations) console.log(violation);
    return;
  }

  console.error(`unknown mode: ${mode ?? "(none)"}`);
  process.exit(2);
};

main();
