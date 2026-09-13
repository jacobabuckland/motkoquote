// The backfill has an entry point, and the entry point runs.
//
// Two money backfills have shipped here as library functions with nothing to
// invoke — every gate green, tests passing, and the deliverable unrunnable; one
// migration is live on production with no caller because of it. So this file
// invokes `scripts/backfill/repair-contract-bodies.ts` as a command, the way a
// person would, rather than importing the function behind it.
//
// The database-reading path cannot be exercised without a service-role
// credential, which CI does not have and must not have. What CAN be pinned
// without one is everything up to that boundary: the command starts, it
// explains itself, it refuses clearly rather than throwing a stack trace when
// the credentials are absent, and it does not mistake a bare invocation for
// permission to write. The judgement inside it is covered by
// `repair-stored-contract.test.ts`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/backfill/repair-contract-bodies.ts";

type Run = { status: number; stdout: string; stderr: string };

// Each distinct invocation is spawned once and shared across the assertions
// about it. These are real subprocesses running alongside the rest of the
// suite, and a `--help` run costs the same whether one test reads it or three.
const cache = new Map<string, Run>();

const run = (args: string[]): Run => {
  const key = args.join(" ");
  const cached = cache.get(key);
  if (cached) return cached;
  const result = spawn(args);
  cache.set(key, result);
  return result;
};

const spawn = (args: string[]): Run => {
  try {
    const stdout = execFileSync("npx", ["tsx", SCRIPT, ...args], {
      encoding: "utf8",
      cwd: resolve(__dirname, "../.."),
      // A bare `...process.env` would hand a developer's own SUPABASE_URL to the
      // credential test and make it pass for the wrong reason. Only what tsx
      // itself needs is carried through.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV ?? "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
};

describe("the deliverable exists as something you can run", () => {
  it("is a file", () => {
    expect(existsSync(resolve(__dirname, "../..", SCRIPT))).toBe(true);
  });

  it("runs, and says what it is for", () => {
    const { status, stdout } = run(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/repair-contract-bodies/);
    expect(stdout).toMatch(/--confirm/);
  });

  it("says in its own usage that it never touches a signed contract", () => {
    // The one guarantee an operator needs to read before running it.
    expect(run(["--help"]).stdout).toMatch(/[Nn]ever touches a signed contract/);
  });
}, 120_000);

describe("it refuses rather than crashing when it cannot reach the database", () => {
  it("names the missing credential and exits non-zero", () => {
    const { status, stderr } = run([]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/SUPABASE_URL/);
    // A stack trace here would mean it got as far as the client and fell over,
    // which is the shape that makes an operator think the data is unreachable
    // when in fact the environment is simply unset.
    expect(stderr).not.toMatch(/at .*\n.*at /);
  });

  it("refuses --contract with no id", () => {
    const { status, stderr } = run(["--contract"]);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/--contract needs a contract id/);
  });
}, 120_000);
