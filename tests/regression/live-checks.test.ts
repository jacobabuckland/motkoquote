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

  // The live config must point at a file that exists. That is the rot this can
  // actually check statically: a path that moves, or an include left behind
  // when the check is renamed.
  //
  // An earlier version of this test SPAWNED vitest with the live config and
  // asserted on its output. It passed locally and failed in CI, where the
  // nested run reported its single test as skipped rather than executing it —
  // vitest run inside vitest inherits parent process state, so the result
  // depends on the environment rather than on the thing being tested. It
  // blocked an unrelated factory item within minutes of merging. A guard whose
  // outcome depends on where it runs is not a guard.
  //
  // The exclude-precedence trap it was reaching for is covered by the assertion
  // above that the workflow uses `--config`, and by the comment in
  // vitest.live.config.ts that says why.
  it("the live config selects at least one file that exists", () => {
    const included = /include:\s*\[([\s\S]*?)\]/.exec(liveConfig)?.[1] ?? "";
    const patterns = [...included.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    expect(patterns.length).toBeGreaterThan(0);

    // Every literal path must exist — that is the rename-left-behind case.
    const literals = patterns.filter((p) => !p.includes("*"));
    for (const p of literals) {
      expect(() => readFileSync(p, "utf8"), `${p} is included but does not exist`).not.toThrow();
    }

    // And at least one literal must be present. Globs are allowed to match
    // nothing on their own — `tests/integration/**` is empty until an item
    // lands one, and failing on that would mean the lane could not be prepared
    // before the work that uses it. But a config made ONLY of globs could match
    // nothing at all, and a live workflow whose config selects nothing exits
    // "No test files found"; the next person then makes it non-fatal, which is
    // how a check stops existing while still appearing in the workflow list.
    // One guaranteed match keeps that from ever being silent.
    expect(
      literals.length,
      "the live config must include at least one literal path, or it could select nothing",
    ).toBeGreaterThan(0);
  });

  it("keeps integration tests out of the gate and in the live lane", () => {
    // They gate on SUPABASE_SERVICE_ROLE_KEY and `it.skipIf` themselves away
    // without it, so in the gate they reported as coverage while never running.
    expect(defaultConfig).toContain("tests/integration/**");
    expect(liveConfig).toContain("tests/integration/**");
  });

  // The live lane moved from carrying one check to carrying a directory of
  // them, and the tests that arrived need a credential the workflow did not
  // supply. Their own `skipIf` guards only the URL and the service-role key, so
  // a missing anon key does not skip them: they run and fail on an undefined
  // key, which reads as a broken test rather than as missing configuration.
  it("supplies every credential the live tests read", () => {
    expect(workflow).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(workflow).toContain("SUPABASE_SERVICE_ROLE_KEY");
    // An RLS test cannot be written with the service-role key alone — that key
    // bypasses RLS by design, so a test using only it proves the WHERE clause
    // and not the policy. The anon-key client is the thing under test.
    expect(
      workflow,
      "cross-tenant tests build an anon-key client as the other contractor",
    ).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("names each missing credential rather than only the first", () => {
    expect(workflow).toMatch(/MISSING/);
    expect(workflow).toContain("not an all-clear");
  });

  it("the workflow refuses to pass when its credentials are missing", () => {
    expect(workflow).toContain("the RLS state of production is unknown");
    expect(workflow).toContain("no live integration test ran");
    expect(workflow).toContain("exit 1");
  });

  it("does not run on pull requests, so a production gap cannot block unrelated work", () => {
    expect(workflow).not.toMatch(/^on:[\s\S]*pull_request/m);
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
  });
});
