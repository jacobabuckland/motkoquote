import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHECK = "scripts/factory/check-deliverable.sh";

function check(spec: string, tests: string): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "deliverable-"));
  const specPath = join(dir, "spec.md");
  const testPath = join(dir, "acceptance.test.ts");
  writeFileSync(specPath, spec);
  writeFileSync(testPath, tests);
  try {
    return { status: 0, out: execFileSync(CHECK, [specPath, testPath], { encoding: "utf8" }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const RUNNABLE_SPEC = [
  "# Correct duplicate credits",
  "",
  "RUNNABLE: npx tsx scripts/backfill/fix-fees.ts --contractor X",
  "",
].join("\n");

describe("a spec with nothing runnable", () => {
  it("passes, because there is nothing to invoke", () => {
    const r = check("# A component\n\nRenders a thing.\n", "it('renders', () => {});");
    expect(r.status).toBe(0);
    expect(r.out).toContain("no-entry-point");
  });
});

describe("a spec that promises something runnable", () => {
  // The exact shape both money backfills shipped in: the library is tested, the
  // entry point does not exist, and every gate is green.
  it("fails when the tests only exercise the library behind it", () => {
    const r = check(
      RUNNABLE_SPEC,
      "import { fixFees } from '@/lib/fix-fees';\nit('corrects', () => { expect(fixFees([])).toEqual([]); });",
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("not-invoked");
    expect(r.out).toContain("::missing-reference::");
  });

  // Naming a script in an existsSync assertion is a test about a file, not
  // about a deliverable.
  it("fails when the tests name the entry point but never run it", () => {
    const r = check(
      RUNNABLE_SPEC,
      "import { existsSync } from 'node:fs';\nit('exists', () => { expect(existsSync('scripts/backfill/fix-fees.ts')).toBe(true); });",
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::missing-invocation::");
    expect(r.out).not.toContain("::missing-reference::");
  });

  it("passes when the tests actually invoke it", () => {
    const r = check(
      RUNNABLE_SPEC,
      [
        "import { execFileSync } from 'node:child_process';",
        "it('runs', () => {",
        "  const out = execFileSync('npx', ['tsx','scripts/backfill/fix-fees.ts','--contractor','X']);",
        "  expect(out.toString()).toContain('corrected');",
        "});",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("invoked");
  });

  it("reads the entry point out of the declared command", () => {
    const r = check(RUNNABLE_SPEC, "import { execFileSync } from 'node:child_process';\nexecFileSync('scripts/backfill/fix-fees.ts');");
    expect(r.out).toContain("entry=scripts/backfill/fix-fees.ts");
  });

  // Markdown decoration must not defeat it — the same leniency the AMBIGUOUS:
  // check already has, for the same reason: an agent writing markdown reaches
  // for bold, and losing a cycle to a formatting choice is pure waste.
  it("finds the declaration through markdown decoration", () => {
    for (const line of [
      "**RUNNABLE:** npx tsx scripts/backfill/fix-fees.ts",
      "## RUNNABLE: npx tsx scripts/backfill/fix-fees.ts",
      "> RUNNABLE: npx tsx scripts/backfill/fix-fees.ts",
    ]) {
      const r = check(`# Spec\n\n${line}\n`, "it('x', () => {});");
      expect(r.out, line).toContain("entry=scripts/backfill/fix-fees.ts");
    }
  });

  // Reporting "cannot check this" is right; passing it silently is not.
  it("says so when the command has no file path in it", () => {
    const r = check("RUNNABLE: npm run backfill\n", "it('x', () => {});");
    expect(r.status).toBe(0);
    expect(r.out).toContain("unresolved-entry-point");
  });

  it("refuses a spec or test file that does not exist", () => {
    expect(() =>
      execFileSync(CHECK, ["/nonexistent/spec.md", "/nonexistent/test.ts"], { encoding: "utf8" }),
    ).toThrow();
  });
});

describe("the runtime plumbing", () => {
  const pm = readFileSync(".github/workflows/factory-pm.yml", "utf8");

  it("the PM workflow runs the check", () => {
    expect(pm).toContain("scripts/factory/check-deliverable.sh");
  });

  it("the PM is told to declare the entry point and test it end to end", () => {
    expect(pm).toContain("RUNNABLE: <the exact command that runs it>");
    expect(pm).toContain("invoke that command end to end");
  });

  it("the PM is told to omit the line when the item is not runnable", () => {
    expect(pm).toContain("Omit the RUNNABLE line entirely if the item is not runnable");
  });

  it("the contract is written down where the agents read it", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    expect(agents).toContain("A runnable deliverable must be run by its acceptance tests");
    expect(agents).toContain("RUNNABLE:");
  });
});
