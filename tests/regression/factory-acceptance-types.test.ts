import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// #403 shipped an acceptance file that RAN GREEN — 22 tests passing — and still
// could not merge:
//
//   tests/acceptance/403.test.ts(296,57): error TS2554: Expected 0 arguments, but got 1.
//
// `vi.fn(async () => ({ … }))` infers a zero-argument function, so calling the
// mock with an argument is a type error. AGENTS.md names the trap. Nothing
// caught it: eslint does not typecheck, vitest does not care because the extra
// argument is ignored at runtime, and the PM's lint step deliberately skips
// typecheck so a test importing a not-yet-written module can still pass.
//
// This pins the split that makes both possible: an unresolved import is fine,
// everything else is not.

const SCRIPT = "scripts/factory/check-acceptance-types.sh";
const TESTS = "tests/acceptance/99.test.ts"; // any real path; the log decides what it finds

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const withLog = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-types-"));
  dirs.push(dir);
  const path = join(dir, "tsc.log");
  writeFileSync(path, contents);
  return path;
};

const check = (tests: string, log?: string): { status: number; out: string } => {
  try {
    const out = execFileSync(SCRIPT, log ? [tests, log] : [tests], { encoding: "utf8" });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

describe("check-acceptance-types", () => {
  it("allows a test importing a module the Engineer has not written yet", () => {
    // The failing-first contract. Demanding a clean tsc at spec time would
    // permit only tests that import nothing new — #152 was blocked by exactly
    // that, on a test that was correct.
    const log = withLog(
      `${TESTS}(3,29): error TS2307: Cannot find module '@/lib/payment-reassurance-copy' or its corresponding type declarations.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).toContain("no type errors");
  });

  it("allows an export the Engineer has not written yet", () => {
    // TS2307 covers a missing MODULE. It does not cover a missing EXPORT from a
    // module that exists, which is exactly as legitimate — and is what #403's
    // fifth derivation was refused on, eleven times over, on a correct test.
    const log = withLog(
      `${TESTS}(43,15): error TS2339: Property 'formatWhatsLeftResponse' does not exist on type 'typeof import("/x/src/lib/voice/ledger-query-prompt")'.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).toContain("no type errors");
  });

  it("still rejects a property missing from a real type", () => {
    // The discriminator is the type the property is missing FROM. `number` is
    // not a module namespace, so this is a test written against the wrong
    // signature — precisely what this check exists to catch.
    const log = withLog(
      `${TESTS}(34,21): error TS2339: Property 'total' does not exist on type 'number'.\n`,
    );

    expect(check(TESTS, log).status).toBe(1);
  });

  it("does not launder a real error beside a not-yet-written export", () => {
    const log = withLog(
      `${TESTS}(43,15): error TS2339: Property 'f' does not exist on type 'typeof import("/x/m")'.\n` +
        `${TESTS}(34,21): error TS2339: Property 'total' does not exist on type 'number'.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(1);
    expect(out).toContain("'number'");
  });

  it("rejects the zero-arity mock called with an argument — the #403 defect", () => {
    const log = withLog(`${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`);

    const { status, out } = check(TESTS, log);

    expect(status).toBe(1);
    expect(out).toContain("TS2554");
  });

  it("still rejects a real error sitting beside an unresolved import", () => {
    // Dropping TS2307 must not launder the rest of the file.
    const log = withLog(
      `${TESTS}(3,29): error TS2307: Cannot find module '@/lib/not-yet'.\n` +
        `${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`,
    );

    expect(check(TESTS, log).status).toBe(1);
  });

  it("reports only the file it was given", () => {
    // A pre-existing error elsewhere is not this item's to answer for, and
    // blocking on one would make every item wait for an unrelated fix.
    const log = withLog(
      `src/lib/something-else.ts(10,3): error TS2322: Type 'number' is not assignable to type 'string'.\n` +
        `tests/acceptance/999.test.ts(4,1): error TS2554: Expected 0 arguments, but got 1.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).not.toContain("something-else");
  });

  it("passes a clean log", () => {
    expect(check(TESTS, withLog("")).status).toBe(0);
  });

  it("refuses a missing test file rather than passing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-types-"));
    dirs.push(dir);
    expect(check(join(dir, "nope.test.ts"), withLog("")).status).toBe(2);
  });

  it("refuses a missing log rather than compiling and passing by accident", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-types-"));
    dirs.push(dir);
    expect(check(TESTS, join(dir, "absent.log")).status).toBe(2);
  });
});

describe("the PM workflow runs it", () => {
  const pm = readFileSync(".github/workflows/factory-pm.yml", "utf8");

  it("has a step invoking the check", () => {
    expect(pm).toContain("scripts/factory/check-acceptance-types.sh");
  });

  it("runs it after lint, so the cheaper check reports first", () => {
    expect(pm.indexOf("Acceptance tests must pass lint")).toBeLessThan(
      pm.indexOf("check-acceptance-types.sh"),
    );
  });

  it("blocks the item rather than pushing a test nobody may repair", () => {
    const step = pm.slice(pm.indexOf("check-acceptance-types.sh"));
    expect(step).toContain("--add-label blocked");
  });
});
