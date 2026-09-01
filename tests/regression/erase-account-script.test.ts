// The erase-account script is a RUNNABLE deliverable, so it is invoked end to
// end here rather than imported. Two money backfills have shipped as library
// functions with no working entry point, every gate green, and neither could be
// run — importing the function behind a script proves nothing about the script.
//
// These exercise the paths that do not need production credentials: argument
// handling, and the refusal to do anything without a service-role key. The
// erasure itself is covered against a stubbed admin client in
// account-erasure.test.ts.

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const SCRIPT = "scripts/backfill/erase-account.ts";

// The script exits non-zero on every path tested here, and execFile rejects on
// a non-zero exit — so the rejection IS the result, and its stdout/stderr are
// what we assert on.
const invoke = async (
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> => {
  try {
    const { stdout, stderr } = await run("npx", ["tsx", SCRIPT, ...args], {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        ...env,
      },
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
};

describe("scripts/backfill/erase-account.ts", () => {
  it("runs, and prints usage when no account is named", async () => {
    const { code, stderr } = await invoke([]);

    expect(code).toBe(2);
    expect(stderr).toContain("--user <uuid>");
  }, 90_000);

  it("rejects --user with no value rather than treating the next flag as an id", async () => {
    const { code, stderr } = await invoke(["--user", "--confirm"]);

    expect(code).toBe(2);
    expect(stderr).toContain("--user <uuid>");
  }, 90_000);

  it("refuses to run without a service-role key", async () => {
    const { code, stderr } = await invoke(["--user", "11111111-1111-1111-1111-111111111111"]);

    expect(code).toBe(2);
    expect(stderr).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  }, 90_000);

  it("still refuses when only half the credentials are present", async () => {
    const { code, stderr } = await invoke(["--user", "11111111-1111-1111-1111-111111111111"], {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
    });

    expect(code).toBe(2);
    expect(stderr).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  }, 90_000);

  it("documents its own entry point in a RUNNABLE line", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(SCRIPT, "utf8");

    expect(source).toContain("RUNNABLE: npx tsx scripts/backfill/erase-account.ts --user <uuid>");
  });

  it("is dry by default — --confirm is what executes", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(SCRIPT, "utf8");

    // A destructive one-off that erases on its default invocation is one
    // mistyped command away from erasing the wrong account.
    expect(source).toContain('const confirm = args.includes("--confirm")');
    expect(source).toContain("Dry run. Nothing has been changed.");
  });
});
