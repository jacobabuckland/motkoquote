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
// The check that closed that hole then blocked #403 three more times, on
// diagnostics a CORRECT failing-first test produces. So the rule is an
// allowlist, not a denylist: report only what the test declares about itself
// and no implementation can change. This pins that split in both directions —
// the silence matters as much as the block, because a false block costs the
// item a cycle and freezes a test nobody downstream may repair.

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

const PASSED = "no self-contradicting type errors";

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
    expect(out).toContain(PASSED);
  });

  it("allows an export the Engineer has not written yet", () => {
    // TS2307 covers a missing MODULE. It does not cover a missing EXPORT from a
    // module that exists, which is exactly as legitimate — and is what #403's
    // fifth derivation was refused on, on a correct test.
    const log = withLog(
      `${TESTS}(43,15): error TS2339: Property 'formatWhatsLeftResponse' does not exist on type 'typeof import("/x/src/lib/voice/ledger-query-prompt")'.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).toContain(PASSED);
  });

  it("allows a property missing from an existing type the item is changing", () => {
    // This is the one an earlier version of this check got wrong, and it cost
    // #403 a sixth derivation. `Property 'total' does not exist on type
    // 'number'` reads like a test written against the wrong signature. It is
    // not: #403 changes getWhatsLeft from Promise<number> to
    // Promise<WhatsLeftAnswer>, so `(await getWhatsLeft()).total` is precisely
    // the assertion the item exists to make. EVERY item that changes an
    // existing signature produces this shape, and the check cannot tell those
    // apart from a genuine mistake — so it must stay silent.
    const log = withLog(
      `${TESTS}(34,21): error TS2339: Property 'total' does not exist on type 'number'.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).toContain(PASSED);
  });

  it("allows an argument that does not fit a signature the item is changing", () => {
    // Same reasoning from the call side: a test passing the new option bag to a
    // function that does not accept it yet is the contract, not a defect.
    const log = withLog(
      `${TESTS}(51,9): error TS2345: Argument of type '{ jobId: string; }' is not assignable to parameter of type 'string'.\n`,
    );

    expect(check(TESTS, log).status).toBe(0);
  });

  it("rejects the zero-arity mock called with an argument — the #403 defect", () => {
    // The only shape on the allowlist. The test wrote the mock's signature
    // itself, so no Engineer can make the call site typecheck.
    const log = withLog(`${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`);

    const { status, out } = check(TESTS, log);

    expect(status).toBe(1);
    expect(out).toContain("TS2554");
  });

  it("rejects the required-arity mock called with none — the #438 defect", () => {
    // The opposite direction, and the fix for #403 steered straight into it on
    // the very next derivation. `vi.fn(async (_id: string) => …)` requires an
    // argument, so calling it with none is the same self-contradiction wearing
    // a hat. Both are on the allowlist; the answer to both is a trailing `?`.
    const log = withLog(`${TESTS}(296,57): error TS2554: Expected 1 arguments, but got 0.\n`);

    expect(check(TESTS, log).status).toBe(1);
  });

  it("allows a call with MORE arguments than the signature the item is about to widen", () => {
    // The false positive that blocked PFIX-2 (#528) and PFIX-4 (#529) twice
    // each, in one morning, while both tests were correct.
    //
    // `extractStatedPrices(transcript)` takes one parameter. PFIX-2's entire job
    // is to hand it the speaker-labelled turns as a second, so its failing-first
    // test calls it with two — and against the current signature that is
    // "Expected 1 arguments, but got 2". That is the acceptance test doing
    // exactly what the factory asks of it: describing code that does not exist
    // yet.
    //
    // The check used to grep the bare TS2554 code and report every match under a
    // fixed narrative about `vi.fn`, a call that appears nowhere in this failure.
    // The discriminator is the ZERO: nothing on the roadmap turns a real
    // function into a zero-parameter one, so only a zero on one side is a
    // signature the test must have written itself.
    const log = withLog(`${TESTS}(24,101): error TS2554: Expected 1 arguments, but got 2.\n`);

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).toContain(PASSED);
  });

  it("allows a widened call sitting beside a genuine self-contradiction being reported", () => {
    // The two shapes must be separated within one log, not decided by whichever
    // appears first: the zero-arity mock still blocks, and the widened call
    // still does not become a reason to block on its own.
    const log = withLog(
      `${TESTS}(24,101): error TS2554: Expected 1 arguments, but got 2.\n` +
        `${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(1);
    expect(out).toContain("Expected 0 arguments");
    expect(out).not.toContain("Expected 1 arguments, but got 2");
  });

  it("still rejects a self-contradiction sitting beside an unresolved import", () => {
    // Ignoring the legitimate diagnostics must not launder the rest of the file.
    const log = withLog(
      `${TESTS}(3,29): error TS2307: Cannot find module '@/lib/not-yet'.\n` +
        `${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`,
    );

    expect(check(TESTS, log).status).toBe(1);
  });

  it("reports only the file it was given", () => {
    // A pre-existing error elsewhere is not this item's to answer for, and
    // blocking on one would make every item wait for an unrelated fix. The
    // second line is an allowlisted shape in ANOTHER acceptance file, so it
    // proves the file filter and not merely the diagnostic filter.
    const log = withLog(
      `src/lib/something-else.ts(10,3): error TS2322: Type 'number' is not assignable to type 'string'.\n` +
        `tests/acceptance/999.test.ts(4,1): error TS2554: Expected 0 arguments, but got 1.\n`,
    );

    const { status, out } = check(TESTS, log);

    expect(status).toBe(0);
    expect(out).not.toContain("something-else");
    expect(out).not.toContain("999.test.ts");
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

describe("the allowlist is stated as one, so widening it is a visible diff", () => {
  const script = readFileSync(SCRIPT, "utf8");

  it("selects the diagnostics to report, rather than excluding some", () => {
    // If a later change reaches for a denylist again — "everything except X" —
    // this fails, and the comment above it explains why that shape is wrong.
    const selector = script.split("\n").find((l) => l.startsWith("REAL="));
    expect(selector, "the selecting line must be named REAL=").toBeDefined();
    expect(selector).not.toMatch(/grep\s+(-\w*v|--invert-match)/);
    expect(selector?.match(/TS\d+/g)).toEqual(["TS2554"]);
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
