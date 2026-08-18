import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPOSER = "scripts/factory/decision-section.sh";
const EVIDENCE = "scripts/factory/failure-evidence.sh";

const WORKFLOWS = [
  "factory-pm.yml",
  "factory-engineer.yml",
  "factory-qa.yml",
] as const;

const wf = (name: string): string => readFileSync(`.github/workflows/${name}`, "utf8");

function compose(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(COMPOSER, args, { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const FIELDS = [
  "**Question:**",
  "**Options:**",
  "**Recommendation:**",
  "**Fixes outside my permissions:**",
  "**To resume:**",
];

describe("the DECISION NEEDED composer", () => {
  it("renders every field the digest reads", () => {
    const { status, stdout } = compose([
      "140",
      "verify",
      "Is it x or y?",
      "(a) x (b) y",
      "x, because z.",
      "none",
    ]);
    expect(status).toBe(0);
    for (const field of FIELDS) expect(stdout).toContain(field);
  });

  // The field exists because an agent enumerates options inside what it may
  // edit, so the correct fix can be structurally invisible to it. A field
  // every call site is allowed to omit is a field every call site omits.
  it("refuses to compose a section that does not answer the permissions question", () => {
    const { status, stderr } = compose(["140", "verify", "Q?", "(a) x", "Do x."]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("permissions is empty");
  });

  it("distinguishes 'nothing found' from 'not assessed'", () => {
    const none = compose(["140", "verify", "Q?", "(a) x", "R.", "none"]).stdout;
    const unknown = compose(["140", "verify", "Q?", "(a) x", "R.", "unknown"]).stdout;
    expect(none).toContain("none identified");
    expect(unknown).toContain("not assessed");
    expect(none).not.toEqual(unknown);
  });

  it("renders a specific boundary verbatim", () => {
    const { stdout } = compose([
      "140",
      "none",
      "Q?",
      "(a) x",
      "R.",
      "The fix is in tests/acceptance/140.test.tsx, which the Engineer may not edit.",
    ]);
    expect(stdout).toContain("which the Engineer may not edit");
  });

  it("still refuses an empty question, an empty options list and an unknown stage", () => {
    expect(compose(["140", "verify", "", "(a) x", "R.", "none"]).status).not.toBe(0);
    expect(compose(["140", "verify", "Q?", "", "R.", "none"]).status).not.toBe(0);
    expect(compose(["140", "nonsense", "Q?", "(a) x", "R.", "none"]).status).not.toBe(0);
    expect(compose(["notanumber", "verify", "Q?", "(a) x", "R.", "none"]).status).not.toBe(0);
  });
});

/**
 * Extract every composer invocation from a workflow and run it for real.
 *
 * Counting arguments by eye is exactly the check that passes while the thing it
 * describes is broken. A call site that drifts back to five arguments does not
 * fail loudly — it produces a block with no comment, which is the one outcome
 * this whole layer exists to prevent — so each invocation is executed here with
 * stand-in values and its output inspected.
 */
function invocationsIn(workflow: string): string[] {
  const lines = wf(workflow).split("\n");
  const calls: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/decision-section\.sh /.test(lines[i])) continue;
    // Prose mentions the composer too; only invocations are executable.
    if (/^\s*#/.test(lines[i])) continue;
    if (/-x |\]; then|git show|chmod/.test(lines[i])) continue;
    const block: string[] = [];
    let j = i;
    for (;;) {
      block.push(lines[j].trim().replace(/\\$/, ""));
      if (!lines[j].trimEnd().endsWith("\\")) break;
      j++;
    }
    calls.push(block.join(" "));
    i = j;
  }
  return calls;
}

const STANDINS = Object.entries({
  ISSUE: "140",
  ISSUE_NUMBER: "140",
  BRANCH: "factory/140",
  SHA: "abc1234",
  URL: "https://example.invalid/run",
  RUN_URL: "https://example.invalid/run",
  FAILED_STEP: "Implement",
  FROZEN: "tests/acceptance/140.test.tsx",
  FROZEN_HITS: "tests/acceptance/140.test.tsx",
  Q: "A question?",
  O: "(a) one (b) two",
  R: "A recommendation.",
  P: "unknown",
})
  .map(([k, v]) => `${k}='${v}'`)
  .join("; ");

function runInvocation(call: string): { status: number; stdout: string; stderr: string } {
  const script = call
    // Both spellings appear: the branch-local path and the copy materialised
    // from main for branches cut before the composer existed.
    .replace(/\/tmp\/decision-section\.sh/g, COMPOSER)
    .replace(/scripts\/factory\/decision-section\.sh/g, COMPOSER)
    // GitHub expressions are resolved by the runner, not by bash.
    .replace(/\$\{\{[^}]*\}\}/g, "140")
    // Redirects would hide the output this test exists to inspect.
    .replace(/\s*>\s*\S+\s*$/, "");
  try {
    const stdout = execFileSync("bash", ["-c", `${STANDINS}; ${script}`], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("every blocking path composes a complete section", () => {
  it("finds invocations in all three stage workflows", () => {
    for (const w of WORKFLOWS) {
      expect(invocationsIn(w).length, `${w} should compose blocking sections`).toBeGreaterThan(0);
    }
  });

  for (const workflow of WORKFLOWS) {
    it(`${workflow}: every invocation renders all six fields`, () => {
      for (const call of invocationsIn(workflow)) {
        const { status, stdout, stderr } = runInvocation(call);
        const where = `${workflow}: ${call.slice(0, 90)}…`;
        expect(status, `${where}\n${stderr}`).toBe(0);
        for (const field of FIELDS) {
          expect(stdout, `${where} is missing ${field}`).toContain(field);
        }
      }
    });
  }

  // The composer is the only thing the digest parses, but two paths hand-roll
  // the section for the case where it was never materialised. They have to
  // carry the same fields or the digest drops what they say.
  it("hand-rolled fallback sections carry the same fields", () => {
    for (const workflow of WORKFLOWS) {
      const text = wf(workflow);
      if (!text.includes("## DECISION NEEDED\\n")) continue;
      expect(text, `${workflow} inline section must state the permissions field`).toContain(
        "**Fixes outside my permissions:**",
      );
    }
  });

  it("the digest surfaces the permissions field it now receives", () => {
    expect(wf("factory-decisions-digest.yml")).toContain("Fixes outside my permissions");
  });
});

describe("failures are reported from evidence, not from the step's name", () => {
  it("the evidence composer exists and is executable", () => {
    expect(statSync(EVIDENCE).mode & 0o111).toBeGreaterThan(0);
  });

  it("says so plainly when it has no run to read, rather than emitting nothing", () => {
    const out = execFileSync(EVIDENCE, [], { encoding: "utf8" });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("no run id");
  });

  it("never exits non-zero, so it cannot take a blocking path down with it", () => {
    // A run id that cannot resolve: the composer must still produce a block.
    const out = execFileSync("bash", ["-c", `${EVIDENCE} 0 5 2>/dev/null; echo "exit=$?"`], {
      encoding: "utf8",
    });
    expect(out).toContain("exit=0");
  });

  it("is materialised anywhere it is called from a factory branch", () => {
    for (const workflow of ["factory-engineer.yml", "factory-qa.yml"]) {
      const text = wf(workflow);
      if (!text.includes("/tmp/failure-evidence.sh")) continue;
      expect(text, `${workflow} calls the evidence composer but never materialises it`).toContain(
        "git show origin/main:scripts/factory/failure-evidence.sh",
      );
    }
  });

  it("both agent catch-alls quote the run before asking about it", () => {
    for (const workflow of ["factory-engineer.yml", "factory-qa.yml"]) {
      expect(wf(workflow), `${workflow} catch-all must call the evidence composer`).toContain(
        "/tmp/failure-evidence.sh",
      );
    }
  });

  // The specific regression: a `case` over the failing step's NAME, each arm
  // asserting a cause nobody had read. Four of five such recommendations were
  // checked in the field review and four rested on a false premise.
  it("no catch-all derives a cause from the failing step's name", () => {
    for (const workflow of WORKFLOWS) {
      expect(wf(workflow), `${workflow} still switches on the step name`).not.toMatch(
        /case\s+"\$FAILED_STEP"\s+in/,
      );
    }
  });

  it("the engineer's default question asserts no cause", () => {
    const text = wf("factory-engineer.yml");
    expect(text).toContain("its cause is not determined");
    expect(text).toContain("No cause is asserted here deliberately");
  });

  it("the red-gate report quotes the failing log it already fetched", () => {
    const text = wf("factory-engineer.yml");
    expect(text).toContain("Last 20 lines of the failing job:");
    expect(text).toContain("tail -n 20 /tmp/ci-failed.log");
  });
});
