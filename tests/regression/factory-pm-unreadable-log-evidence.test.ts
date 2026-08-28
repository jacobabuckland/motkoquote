import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * #403 blocked with `::unreadable-log::` — vitest exited non-zero and printed
 * no `Tests` summary line — and the reason was gone before anyone read the
 * block.
 *
 * Nothing is pushed on this path, by design: the acceptance file the PM wrote
 * dies with the runner. So the only evidence that outlives the job is what this
 * step prints. It printed the classifier's verdict and not the vitest output,
 * which means that for the one verdict whose whole content is "I could not read
 * this run", it published no readable thing at all. The item could then only be
 * re-derived blind, which is the same gamble that produced it.
 *
 * The second half is the advice. `::no-tests-executed::` names the specifier
 * that failed to resolve, so "check the specifier named above" is actionable;
 * `::unreadable-log::` names nothing and cannot, so the same sentence sends the
 * reader hunting for a line that was never written. #403's block carried it
 * anyway.
 *
 * These drive the step's real shell body out of the workflow — vitest and gh
 * stood in for, everything else genuine — because the claim is about what the
 * comment ends up containing, not about how the YAML is phrased.
 */

const WORKFLOW = ".github/workflows/factory-pm.yml";
const STEP = "Acceptance tests must fail before implementation";

/**
 * Lift the step's `run:` block scalar out of the workflow.
 *
 * Hand-sliced rather than parsed: no YAML library is a declared dependency
 * here, and reaching for a transitive one puts this file at the mercy of
 * somebody else's dependency tree. Both anchors are exact, so drift in the
 * workflow surfaces as a thrown error naming what moved rather than as a
 * silently empty script.
 */
const stepScript = (): string => {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");

  const start = lines.findIndex((l) => l.trim() === `- name: ${STEP}`);
  if (start === -1) throw new Error(`step "${STEP}" not found in ${WORKFLOW}`);

  const runAt = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  if (runAt === -1) throw new Error(`step "${STEP}" has no "run: |" block`);

  const indent = (lines[runAt].match(/^\s*/)?.[0].length ?? 0) + 2;
  const body: string[] = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (!line.startsWith(" ".repeat(indent))) break;
    body.push(line.slice(indent));
  }
  if (body.length === 0) throw new Error(`step "${STEP}" has an empty run body`);
  return body.join("\n");
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Run = { status: number; stdout: string; comment: string };

/**
 * Run the step with a vitest that prints `vitestOutput` and fails.
 *
 * `gh` is a recorder: it writes whichever --body-file it is handed to a known
 * path, so the test reads the comment that would have been posted rather than
 * asserting on the code that composes it.
 */
const runStep = (vitestOutput: string): Run => {
  const dir = mkdtempSync(join(tmpdir(), "pm-step-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "vitest-output.txt"), vitestOutput);

  // npx vitest run <path> — non-zero, with the canned output on stdout. The
  // step redirects it to /tmp/acceptance.log itself, which is the thing under
  // test, so this must not write that file.
  const npx = join(dir, "bin/npx");
  writeFileSync(npx, `#!/usr/bin/env bash\ncat "${join(dir, "vitest-output.txt")}"\nexit 1\n`);
  chmodSync(npx, 0o755);

  const gh = join(dir, "bin/gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash\n` +
      `prev=""\n` +
      `for a in "$@"; do\n` +
      `  if [ "$prev" = "--body-file" ]; then cp "$a" "${join(dir, "comment.md")}"; fi\n` +
      `  prev="$a"\n` +
      `done\n` +
      `exit 0\n`,
  );
  chmodSync(gh, 0o755);

  // A spec with no `(new)` entries: the classifier only consults it on the
  // no-tests-executed path, and these fixtures never reach it.
  const spec = resolve("docs/specs/999999.md");
  writeFileSync(spec, "# fixture spec\n\n## Files\n\n- src/nothing.ts\n");

  try {
    const res = spawnSync("bash", ["-c", stepScript()], {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        ISSUE: "999999",
        TESTS: "tests/acceptance/999999.test.ts",
        GH_TOKEN: "unused",
      },
    });
    let comment = "";
    try {
      comment = readFileSync(join(dir, "comment.md"), "utf8");
    } catch {
      comment = "";
    }
    return { status: res.status ?? -1, stdout: `${res.stdout}${res.stderr}`, comment };
  } finally {
    rmSync(spec, { force: true });
  }
};

// Real vitest output shapes. The load failure is the one the classifier can
// read; the crash is #403's, and its defining feature is the ABSENCE of a
// `Tests` line rather than anything present in it.
const LOAD_FAILURE = [
  " RUN  v4.1.10 /home/user/motkoquote",
  "",
  "Error: Failed to load url @/lib/does-not-exist",
  "",
  " Test Files  1 failed (1)",
  "      Tests  no tests",
].join("\n");

const NO_SUMMARY = [
  " RUN  v4.1.10 /home/user/motkoquote",
  "",
  "Error: Vitest caught 1 unhandled error during the test run.",
  "ELIFECYCLE  Command failed with exit code 1.",
].join("\n");

describe("the PM's acceptance-run step, on a run it could not classify", () => {
  it("publishes the vitest output, because nothing is pushed and the file dies with the runner", () => {
    const { comment, status } = runStep(NO_SUMMARY);

    expect(status, "the step must still block the item").not.toBe(0);
    expect(
      comment,
      "the block must quote what vitest printed, or the cause is gone with the runner",
    ).toContain("Vitest caught 1 unhandled error");
  });

  it("puts it in the job log too, where it survives even if the comment fails to post", () => {
    const { stdout } = runStep(NO_SUMMARY);

    expect(stdout).toContain("vitest output (tail)");
    expect(stdout).toContain("ELIFECYCLE");
  });

  it("does not send the reader looking for a specifier it never named", () => {
    const { comment } = runStep(NO_SUMMARY);

    // The whole point of this verdict is that the run could not be read, so
    // there is no unresolved specifier above and there cannot be one.
    expect(comment).not.toContain("Check the specifier named above");
    expect(comment).toContain("this verdict names none");
  });
});

describe("and on a run it could", () => {
  it("keeps the specifier advice, which is actionable there", () => {
    const { comment, status } = runStep(LOAD_FAILURE);

    expect(status).not.toBe(0);
    expect(comment).toContain("Check the specifier named above");
    expect(comment).not.toContain("this verdict names none");
  });
});
