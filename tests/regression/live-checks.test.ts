import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `src/checks/rls.check.test.ts` asserts something about PRODUCTION, not about
 * this tree. It needs a service-role key, which the CI gate must not have — this
 * repository is public and its Actions logs are world-readable — so it is
 * excluded from the default suite and run on a schedule instead.
 *
 * Every assertion here guards a way that arrangement can rot into a check that
 * exists on paper and runs nowhere. That is worse than no check: it reports
 * success.
 */
describe("the live RLS check is excluded from the gate but still has a runner", () => {
  const defaultConfig = readFileSync("vitest.config.ts", "utf8");
  const liveConfig = readFileSync("vitest.live.config.ts", "utf8");
  const workflow = readFileSync(".github/workflows/rls-check.yml", "utf8");

  it("is out of the default suite, which has no credentials for it", () => {
    expect(defaultConfig).toContain("src/checks/rls.check.test.ts");
    expect(defaultConfig).toContain("exclude");
  });

  it("is in the live config, so something still runs it", () => {
    expect(liveConfig).toContain("src/checks/rls.check.test.ts");
    expect(liveConfig).toContain("include");
  });

  // The trap this is really guarding. vitest's `--exclude` APPENDS to the
  // config's exclude list rather than replacing it, and naming an excluded file
  // on the command line does not override the exclusion either — so the obvious
  // spelling finds no test files and the workflow reports having run a check it
  // never ran.
  it("the workflow uses its own config rather than a flag or a named file", () => {
    // The invocation only — the comment above it names `--exclude` precisely to
    // explain why it is not used, and matching prose here would fail on that.
    const invocations = workflow
      .split("\n")
      .filter((l) => /npx vitest/.test(l) && !/^\s*#/.test(l));
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toContain("--config vitest.live.config.ts");
    expect(invocations[0]).not.toContain("--exclude");
    expect(invocations[0]).not.toContain("src/checks");
  });

  it("the live config actually selects the check, rather than selecting nothing", () => {
    // Run it for real and read what vitest collected. An empty selection exits
    // non-zero with "No test files found"; a real one reaches the credential
    // guard inside the check itself.
    let output = "";
    try {
      output = execFileSync("npx", ["vitest", "run", "--config", "vitest.live.config.ts"], {
        encoding: "utf8",
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(output).not.toContain("No test files found");
    expect(output).toContain("Database credentials not configured");
  }, 60_000);

  it("the workflow refuses to pass when its credentials are missing", () => {
    expect(workflow).toContain("is not set, so the RLS state of production is unknown");
    expect(workflow).toContain("exit 1");
  });

  it("does not run on pull requests, so a production gap cannot block unrelated work", () => {
    expect(workflow).not.toMatch(/^on:[\s\S]*pull_request/m);
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
  });
});
