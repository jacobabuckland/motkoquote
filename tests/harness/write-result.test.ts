import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import exampleResult from "../../harness/results/example-result.json";
import {
  loadSchema,
  parseNextFix,
  pickTopFailure,
  runCli,
  validateHarnessResult,
  writeHarnessResult,
  WriterValidationError,
  type HarnessCase,
  type HarnessResult,
} from "../../harness/write-result";

const here = dirname(fileURLToPath(import.meta.url));
const repoHarness = join(here, "../../harness");
const schemaPath = join(repoHarness, "harness-result.schema.json");
const schema = loadSchema(repoHarness);

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function seedHarness(nextFix?: string, retest?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-writer-"));
  tempRoots.push(dir);
  mkdirSync(join(dir, "results", "archive"), { recursive: true });
  copyFileSync(schemaPath, join(dir, "harness-result.schema.json"));
  writeFileSync(
    join(dir, "NEXT_FIX.md"),
    nextFix ?? readFileSync(join(repoHarness, "NEXT_FIX.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "RETEST_PROMPT.md"),
    retest ?? readFileSync(join(repoHarness, "RETEST_PROMPT.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "BACKLOG.md"),
    readFileSync(join(repoHarness, "BACKLOG.md"), "utf8"),
    "utf8",
  );
  writeFileSync(
    join(dir, "LESSONS.md"),
    readFileSync(join(repoHarness, "LESSONS.md"), "utf8"),
    "utf8",
  );
  return dir;
}

function baseCase(overrides: Partial<HarnessCase> & Pick<HarnessCase, "id" | "status">): HarnessCase {
  return {
    title: "Test case",
    trade: "electrician",
    persona: "Sole trader",
    tags: ["quote"],
    severity: overrides.status === "passed" ? "low" : "high",
    expected: {
      outcome: "Draft the quote and hold for review.",
      mustInclude: ["2 electricians"],
      mustNotInclude: ["sent to customer"],
    },
    actual: {
      outcome:
        overrides.status === "passed"
          ? "Drafted the quote and held for review."
          : "Quoted 1 electrician and omitted the consumer unit.",
      quoteSummary: null,
      totalGbp: null,
      errors: [],
      screenshots: [],
      audio: [],
    },
    turns: [
      { role: "tradesperson", text: "Full rewire. Two of us, five days.", atMs: 0 },
      { role: "motko", text: "One electrician, five days.", atMs: 1000 },
    ],
    diagnosis: overrides.status === "passed" ? null : "Crew size dropped.",
    ...overrides,
  };
}

function result(overrides: Partial<HarnessResult> & { cases: HarnessCase[] }): HarnessResult {
  const passed = overrides.cases.filter((c) => c.status === "passed").length;
  const failed = overrides.cases.filter((c) => c.status === "failed").length;
  const blocked = overrides.cases.filter((c) => c.status === "blocked").length;
  const top = overrides.cases.find((c) => c.status === "failed" || c.status === "blocked");
  return {
    schemaVersion: "1.0.0",
    runId: "2026-09-19T2300Z-test",
    startedAt: "2026-09-19T23:00:00Z",
    finishedAt: "2026-09-19T23:08:00Z",
    environment: {
      app: "web-main@test",
      voiceModel: "gpt-realtime-test",
      harness: "gpt-tester-v1",
      locale: "en-GB",
    },
    summary: {
      total: overrides.cases.length,
      passed,
      failed,
      blocked,
      topFailureCaseId: top ? top.id : null,
    },
    ...overrides,
  };
}

const honingNextFix = `# NEXT_FIX

> lock

\`\`\`yaml
runId: "2026-09-19T2200Z-rewire"
caseId: "quote-rewire-three-bed"
severity: "high"
trade: "electrician"
resultFile: "harness/results/2026-09-19T2200Z-rewire.json"
status: honing
attempts: 1
fixPr: "https://github.com/jacobabuckland/motkoquote/pull/999"
\`\`\`

## What the tradesperson said

Full rewire on a three-bed semi.

## What Motko did

Quoted 1 electrician for 5 days and omitted the consumer unit line.

## What should have happened

Draft a rewire quote with 2 electricians.

## Evidence

old evidence

## Suspected cause (from harness — verify)

Crew size not applied.

## Acceptance checks

- 2 electricians

## Out of scope

Pricing amounts.
`;

describe("validateHarnessResult", () => {
  it("accepts the committed example-result.json", () => {
    const validated = validateHarnessResult(exampleResult, schema);
    expect(validated.ok).toBe(true);
  });

  it("rejects a missing required field", () => {
    const { runId: _runId, ...broken } = exampleResult;
    void _runId;
    const validated = validateHarnessResult(broken, schema);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.errors.some((e) => e.includes("runId"))).toBe(true);
    }
  });

  it("rejects an extra top-level property", () => {
    const validated = validateHarnessResult({ ...exampleResult, extra: true }, schema);
    expect(validated.ok).toBe(false);
    if (!validated.ok) {
      expect(validated.errors.some((e) => e.includes("extra"))).toBe(true);
    }
  });
});

describe("pickTopFailure", () => {
  it("honours summary.topFailureCaseId when that case failed", () => {
    const run = result({
      summary: {
        total: 2,
        passed: 0,
        failed: 2,
        blocked: 0,
        topFailureCaseId: "quote-skim-ceilings",
      },
      cases: [
        baseCase({ id: "quote-rewire-three-bed", status: "failed", severity: "critical" }),
        baseCase({ id: "quote-skim-ceilings", status: "failed", severity: "low", trade: "plasterer" }),
      ],
    });
    expect(pickTopFailure(run)?.id).toBe("quote-skim-ceilings");
  });
});

describe("writeHarnessResult", () => {
  it("locks the top failure and backlogs the rest when idle", () => {
    const root = seedHarness();
    const outcome = writeHarnessResult(exampleResult, { harnessRoot: root });

    expect(outcome.action).toBe("locked");
    expect(outcome.lockedCaseId).toBe("quote-rewire-three-bed");
    expect(outcome.backlogCaseIds).toEqual([]);
    expect(existsSync(join(root, "results", `${exampleResult.runId}.json`))).toBe(true);

    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("open");
    expect(nextFix.caseId).toBe("quote-rewire-three-bed");
    expect(nextFix.attempts).toBe(0);
    expect(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).toContain("Two of us, five days");
    expect(readFileSync(join(root, "BACKLOG.md"), "utf8")).not.toMatch(
      / · quote-skim-ceilings ·/,
    );
  });

  it("backlogs other failures when idle and more than one case failed", () => {
    const root = seedHarness();
    const run = result({
      cases: [
        baseCase({ id: "quote-rewire-three-bed", status: "failed" }),
        baseCase({
          id: "quote-skim-ceilings",
          status: "failed",
          trade: "plasterer",
          actual: { outcome: "Invented a day rate.", errors: [] },
        }),
      ],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("locked");
    expect(outcome.lockedCaseId).toBe("quote-rewire-three-bed");
    expect(outcome.backlogCaseIds).toEqual(["quote-skim-ceilings"]);
    expect(readFileSync(join(root, "BACKLOG.md"), "utf8")).toContain("quote-skim-ceilings");
  });

  it("leaves NEXT_FIX idle on a clean multi-case pass", () => {
    const root = seedHarness();
    const run = result({
      runId: "2026-09-19T2310Z-clean",
      cases: [
        baseCase({ id: "quote-rewire-three-bed", status: "passed" }),
        baseCase({ id: "quote-skim-ceilings", status: "passed", trade: "plasterer" }),
      ],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("recorded-pass");
    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("idle");
    expect(nextFix.caseId).toBe("");
    expect(readFileSync(join(root, "BACKLOG.md"), "utf8")).not.toMatch(/ · quote-/);
    expect(existsSync(join(root, "results", "2026-09-19T2310Z-clean.json"))).toBe(true);
    expect(existsSync(join(root, "results", "archive", "2026-09-19T2310Z-clean.json"))).toBe(
      false,
    );
  });

  it("does not overwrite an open lock with a different caseId", () => {
    const root = seedHarness(`# NEXT_FIX

\`\`\`yaml
runId: prior
caseId: quote-rewire-three-bed
severity: high
trade: electrician
resultFile: harness/results/prior.json
status: open
attempts: 0
fixPr: ""
\`\`\`

## What the tradesperson said

keep me

## What Motko did

## What should have happened

## Evidence

## Suspected cause (from harness — verify)

## Acceptance checks

## Out of scope
`);
    const run = result({
      runId: "2026-09-19T2320Z-other",
      cases: [
        baseCase({
          id: "quote-skim-ceilings",
          status: "failed",
          trade: "plasterer",
        }),
      ],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("deferred");
    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("open");
    expect(nextFix.caseId).toBe("quote-rewire-three-bed");
    expect(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).toContain("keep me");
    expect(readFileSync(join(root, "BACKLOG.md"), "utf8")).toContain("quote-skim-ceilings");
  });

  it("on a honing fail, keeps the same case and bumps attempts", () => {
    const root = seedHarness(honingNextFix);
    const run = result({
      runId: "2026-09-19T2330Z-retest",
      cases: [baseCase({ id: "quote-rewire-three-bed", status: "failed" })],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("honing-failed");
    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("honing");
    expect(nextFix.caseId).toBe("quote-rewire-three-bed");
    expect(nextFix.attempts).toBe(2);
    expect(nextFix.fixPr).toContain("pull/999");
    const md = readFileSync(join(root, "NEXT_FIX.md"), "utf8");
    expect(md).toContain("2026-09-19T2330Z-retest");
    expect(md).toContain("Crew size");
    expect(md).toContain("Pricing amounts.");
    const retest = readFileSync(join(root, "RETEST_PROMPT.md"), "utf8");
    expect(retest).toMatch(/status:\s*honing/);
    expect(retest).toMatch(/attempts:\s*2/);
  });

  it("on a clean honing retest, archives, idles NEXT_FIX, and appends LESSONS", () => {
    const root = seedHarness(honingNextFix);
    const run = result({
      runId: "2026-09-19T2340Z-retest",
      cases: [baseCase({ id: "quote-rewire-three-bed", status: "passed" })],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("honing-passed");
    expect(existsSync(join(root, "results", "2026-09-19T2340Z-retest.json"))).toBe(false);
    expect(existsSync(join(root, "results", "archive", "2026-09-19T2340Z-retest.json"))).toBe(
      true,
    );
    const nextFix = parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8"));
    expect(nextFix.status).toBe("idle");
    expect(nextFix.caseId).toBe("");
    const retest = readFileSync(join(root, "RETEST_PROMPT.md"), "utf8");
    expect(retest).toMatch(/status:\s*clean/);
    const lessons = readFileSync(join(root, "LESSONS.md"), "utf8");
    expect(lessons).toContain("quote-rewire-three-bed");
    expect(lessons).toContain("omitted the consumer unit");
    expect(lessons).toContain("2026-09-19T2340Z-retest");
  });

  it("while honing, writes only the locked case and backlogs extras", () => {
    const root = seedHarness(honingNextFix);
    const run = result({
      runId: "2026-09-19T2350Z-suite",
      cases: [
        baseCase({ id: "quote-rewire-three-bed", status: "failed" }),
        baseCase({
          id: "quote-skim-ceilings",
          status: "failed",
          trade: "plasterer",
          actual: { outcome: "Skipped the skim.", errors: [] },
        }),
      ],
    });
    const outcome = writeHarnessResult(run, { harnessRoot: root });
    expect(outcome.action).toBe("honing-failed");
    const written = JSON.parse(
      readFileSync(join(root, "results", "2026-09-19T2350Z-suite.json"), "utf8"),
    ) as HarnessResult;
    expect(written.summary.total).toBe(1);
    expect(written.cases.map((c) => c.id)).toEqual(["quote-rewire-three-bed"]);
    expect(readFileSync(join(root, "BACKLOG.md"), "utf8")).toContain("quote-skim-ceilings");
    expect(parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).caseId).toBe(
      "quote-rewire-three-bed",
    );
  });

  it("refuses a reserved runId and does not touch NEXT_FIX", () => {
    const root = seedHarness();
    const before = readFileSync(join(root, "NEXT_FIX.md"), "utf8");
    expect(() =>
      writeHarnessResult({ ...exampleResult, runId: "example-result" }, { harnessRoot: root }),
    ).toThrow(/reserved/);
    expect(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).toBe(before);
  });

  it("rejects path-like runIds before writing", () => {
    const root = seedHarness();
    expect(() =>
      writeHarnessResult({ ...exampleResult, runId: "../escape" }, { harnessRoot: root }),
    ).toThrow(/safe filename/);
  });

  it("throws WriterValidationError on a bad payload", () => {
    const root = seedHarness();
    expect(() => writeHarnessResult({ nope: true }, { harnessRoot: root })).toThrow(
      WriterValidationError,
    );
    expect(parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).status).toBe("idle");
  });
});

describe("runCli", () => {
  it("writes a file argument into a temp harness root", async () => {
    const root = seedHarness();
    const input = join(root, "incoming.json");
    writeFileSync(input, `${JSON.stringify(exampleResult, null, 2)}\n`, "utf8");
    const code = await runCli(["--harness-root", root, input]);
    expect(code).toBe(0);
    expect(parseNextFix(readFileSync(join(root, "NEXT_FIX.md"), "utf8")).status).toBe("open");
  });
});
