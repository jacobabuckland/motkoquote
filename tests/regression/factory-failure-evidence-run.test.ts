import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * QA's blocking comments could never quote a log. Every one of them said "the
 * failing log could not be retrieved for this run", which reads as an access
 * problem and invites a retry.
 *
 * It was neither. QA passed `github.run_id` — its own run — to the evidence
 * composer, and GitHub serves no log archive for a run that has not finished.
 * The job doing the asking is precisely what keeps it unfinished, so that call
 * could not have worked on any attempt. #306 blocked overnight behind a comment
 * naming two possible causes and quoting neither, while the real failure was
 * one flaky assertion sitting in the CI gate run whose id QA already held.
 *
 * These bind both halves: the composer names the in-progress case instead of
 * implying an empty log, and QA hands it the run that actually failed.
 */

const SCRIPT = resolve(__dirname, "../../scripts/factory/failure-evidence.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * A `gh` on PATH that serves the given jobs JSON and log. The script is driven
 * for real; only the GitHub API around it is stood in for.
 */
const fakeGh = (jobsJson: string, log: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-gh-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "jobs.json"), jobsJson);
  if (log !== null) writeFileSync(join(dir, "log.txt"), log);

  const gh = join(dir, "bin/gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash\n` +
      `for a in "$@"; do\n` +
      `  if [ "$a" = "--json" ]; then cat "${join(dir, "jobs.json")}"; exit 0; fi\n` +
      `  if [ "$a" = "--log-failed" ]; then\n` +
      (log === null
        ? `    exit 1\n`
        : `    cat "${join(dir, "log.txt")}"; exit 0\n`) +
      `  fi\n` +
      `done\nexit 1\n`,
  );
  chmodSync(gh, 0o755);
  return dir;
};

const run = (
  ghDir: string,
  runId: string,
  env: Record<string, string> = {},
): { out: string; code: number } => {
  const proc = spawnSync("bash", [SCRIPT, runId, "20"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(ghDir, "bin")}:${process.env.PATH}`, ...env },
  });
  return { out: proc.stdout ?? "", code: proc.status ?? -1 };
};

const jobs = (conclusion: string | null, name = "review") =>
  JSON.stringify({
    jobs: [
      {
        name,
        conclusion,
        url: "https://github.com/o/r/actions/runs/1/job/2",
        steps: [{ name: "Test", conclusion: conclusion === null ? null : "failure" }],
      },
    ],
  });

describe("a run that has not finished", () => {
  it("names the timing instead of implying the log was empty", () => {
    const gh = fakeGh(jobs(null), null);
    const { out, code } = run(gh, "999");

    expect(out).toMatch(/has not finished/i);
    expect(out, "the old wording invited a retry that cannot work").not.toMatch(
      /could not be retrieved/i,
    );
    expect(code).toBe(0);
  });

  it("says outright that a run cannot read its own log", () => {
    const gh = fakeGh(jobs(null), null);
    const { out } = run(gh, "555", { GITHUB_RUN_ID: "555" });

    expect(out).toMatch(/cannot read its own log/i);
    expect(out).not.toMatch(/could not be retrieved/i);
  });
});

describe("a run that has finished", () => {
  it("quotes the failing log", () => {
    const gh = fakeGh(jobs("failure"), "AssertionError: expected 1 to equal 2\n");
    const { out } = run(gh, "999");

    expect(out).toContain("AssertionError");
    expect(out).toMatch(/Failing job\(s\)/);
  });

  // The genuine unavailable case must keep its wording: a finished run whose
  // log will not come back is an access problem, and saying so is correct.
  it("still reports a log it genuinely could not fetch", () => {
    const gh = fakeGh(jobs("failure"), null);
    const { out, code } = run(gh, "999");

    expect(out).toMatch(/could not be retrieved/i);
    expect(out, "an absent log is a fact about the run").toMatch(/not a description of the failure/i);
    expect(code).toBe(0);
  });
});

describe("QA hands it the run that failed", () => {
  const qa = readFileSync(resolve(__dirname, "../../.github/workflows/factory-qa.yml"), "utf8");

  it("exports the gate run id from the step that read it", () => {
    expect(qa).toContain('echo "GATE_RUN_ID=$ID" >> "$GITHUB_ENV"');
  });

  it("composes evidence from the gate run, not from QA's own run", () => {
    expect(qa).toContain('/tmp/failure-evidence.sh "${GATE_RUN_ID:-${{ github.run_id }}}"');
    expect(
      qa.includes('/tmp/failure-evidence.sh "${{ github.run_id }}"'),
      "passing only QA's own run id is the defect",
    ).toBe(false);
  });
});
