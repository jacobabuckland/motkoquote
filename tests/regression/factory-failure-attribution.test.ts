import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/factory/attribute-failure.sh";

/** GitHub prefixes every log line with a timestamp; vitest wraps its markers in colour. */
const gh = (line: string): string => `2026-08-18T10:49:18.0461780Z ${line}`;

/**
 * What `gh run view --log-failed` ACTUALLY emits: job name, step name and
 * timestamp, tab-separated, before anything the tool printed.
 *
 * Every fixture in this file used `gh()` — timestamp only — so none of them was
 * the shape the script is fed in CI, and a normalisation bug that made every
 * real tsc failure unattributable passed this suite unnoticed. See the ordering
 * note in attribute-failure.sh.
 */
const ghFailedLog = (line: string, step = "Run npm run typecheck"): string =>
  `gate\t${step}\t2026-08-25T22:43:23.5476855Z ${line}`;
const green = (s: string): string => `[32m${s}[39m`;
const fail = (s: string): string => `[41m[1m FAIL [22m[49m ${s}`;
const dim = (s: string): string => `[2m${s}[22m`;

function attribute(log: string): { sources: string[]; frozen: string[]; raw: string } {
  const dir = mkdtempSync(join(tmpdir(), "attribute-"));
  const file = join(dir, "failing.log");
  writeFileSync(file, log);
  const raw = execFileSync(SCRIPT, [file], { encoding: "utf8" });
  const line = (prefix: string): string[] =>
    raw
      .split("\n")
      .filter((l) => l.startsWith(prefix))
      .map((l) => l.slice(prefix.length));
  return { sources: line("source="), frozen: line("frozen="), raw };
}

/**
 * #244's real log shape: five acceptance tests PASSING, one regression test
 * failing. The old heuristic named all five frozen files as the cause and none
 * of them had failed.
 */
const LOG_244 = [
  gh(` ${green("✓")} tests/acceptance/101.test.ts ${dim("(1 test)")}`),
  gh(` ${green("✓")} tests/acceptance/106.test.ts ${dim("(1 test)")}`),
  gh(` ${green("✓")} tests/acceptance/108.test.ts ${dim("(1 test)")}`),
  gh(` ${green("✓")} tests/acceptance/113.test.ts ${dim("(1 test)")}`),
  gh(` ${green("✓")} tests/acceptance/115.test.ts ${dim("(1 test)")}`),
  gh(fail(`tests/regression/live-checks.test.ts${dim(" > ")}the live RLS check${dim(" > ")}selects it`)),
  gh(` ${dim("❯")} tests/regression/live-checks.test.ts:${dim("62:20")}`),
].join("\n");

describe("the #244 regression", () => {
  it("names the file that failed, not the ones that merely appear", () => {
    const { sources } = attribute(LOG_244);
    expect(sources).toEqual(["tests/regression/live-checks.test.ts"]);
  });

  it("attributes nothing frozen, because nothing frozen failed", () => {
    expect(attribute(LOG_244).frozen).toEqual([]);
  });

  // The trap, pinned so it cannot come back: the old check tried to exclude
  // passing lines by anchoring on the marker, but vitest puts ANSI colour codes
  // before it, so the marker is never at the start of the line.
  it("is not fooled by colour codes in front of the pass marker", () => {
    const { sources } = attribute(gh(` ${green("✓")} tests/acceptance/999.test.ts (1 test)`));
    expect(sources).toEqual([]);
  });
});

describe("when a frozen file genuinely is the failure", () => {
  it("reports it", () => {
    const log = gh(fail(`tests/acceptance/171.test.ts${dim(" > ")}a thing${dim(" > ")}another`));
    const { sources, frozen } = attribute(log);
    expect(sources).toEqual(["tests/acceptance/171.test.ts"]);
    expect(frozen).toEqual(["tests/acceptance/171.test.ts"]);
  });

  it("reports a spec file too", () => {
    expect(attribute(gh(fail("docs/specs/240.md > x"))).frozen).toEqual(["docs/specs/240.md"]);
  });

  it("reports a tsc diagnostic against a frozen file", () => {
    const log = gh("tests/acceptance/240.test.ts(214,38): error TS2345: Argument of type 'Request'");
    const { sources, frozen } = attribute(log);
    expect(sources).toEqual(["tests/acceptance/240.test.ts"]);
    expect(frozen).toEqual(["tests/acceptance/240.test.ts"]);
  });

  it("reports an ESLint error against a frozen file", () => {
    const log = [
      gh("/home/runner/work/motkoquote/motkoquote/tests/acceptance/145.test.ts"),
      gh("  12:3  error  'module' is restricted  @next/next/no-assign-module-variable"),
    ].join("\n");
    expect(attribute(log).frozen).toEqual(["tests/acceptance/145.test.ts"]);
  });

  // A warning is not a failure, and a file with only warnings did not fail.
  it("ignores an ESLint block that has only warnings", () => {
    const log = [
      gh("/home/runner/work/motkoquote/motkoquote/tests/acceptance/219.test.tsx"),
      gh("  16:47  warning  'beforeEach' is defined but never used"),
    ].join("\n");
    expect(attribute(log).sources).toEqual([]);
  });
});

describe("when the failure cannot be identified", () => {
  // Saying so is the point. A guess here sends a human to the wrong file.
  it("says unidentified rather than naming something", () => {
    const { raw, sources } = attribute(gh("Process completed with exit code 1."));
    expect(raw).toContain("unidentified");
    expect(sources).toEqual([]);
  });

  it("says so when there is no log at all", () => {
    const raw = execFileSync(SCRIPT, ["/nonexistent/failing.log"], { encoding: "utf8" });
    expect(raw).toContain("unidentified");
    expect(raw).toContain("no-log");
  });

  it("never exits non-zero, so it cannot take a blocking path down with it", () => {
    const out = execFileSync("bash", ["-c", `${SCRIPT} /nonexistent 2>/dev/null; echo "exit=$?"`], {
      encoding: "utf8",
    });
    expect(out).toContain("exit=0");
  });
});

describe("several failures at once", () => {
  it("reports each distinct failing source once", () => {
    const log = [
      gh(fail("tests/acceptance/188.test.ts > a > b")),
      gh(fail("tests/acceptance/188.test.ts > a > c")),
      gh(fail("src/lib/thing.test.ts > d")),
    ].join("\n");
    const { sources, frozen } = attribute(log);
    expect(sources).toEqual(["src/lib/thing.test.ts", "tests/acceptance/188.test.ts"]);
    expect(frozen).toEqual(["tests/acceptance/188.test.ts"]);
  });
});

// Shipped 18 Aug; broke on its first real failure the same morning. The gate on
// #244 was nothing but tsc diagnostics and this named none of them, because
// GitHub rewrites any line a step marks as an error into `##[error]<line>`, and
// those characters are legal in a path — so the pattern still matched and
// silently captured `##[error]tests/…` as the filename.
describe("GitHub's workflow-command prefixes", () => {
  it("attributes tsc diagnostics that GitHub has marked as errors", () => {
    const { sources, raw } = attribute(
      [
        gh("> tsc --noEmit"),
        gh("##[error]tests/integration/244-deletion-behavior.test.ts(36,40): error TS2304: Cannot find name 'admin'."),
        gh("##[error]tests/integration/244-edge-cases.test.ts(37,40): error TS2304: Cannot find name 'admin'."),
        gh("##[error]tests/integration/244-edge-cases.test.ts(122,40): error TS7006: Parameter 'sum' implicitly has an 'any' type."),
        gh("##[error]Process completed with exit code 2."),
      ].join("\n"),
    );

    expect(sources).toContain("tests/integration/244-deletion-behavior.test.ts");
    expect(sources).toContain("tests/integration/244-edge-cases.test.ts");
    expect(raw, "the annotation prefix must not survive into the path").not.toContain("##[error]");
    expect(raw).not.toContain("unidentified");
  });

  it("still sees a frozen file when the diagnostic is annotated", () => {
    const { sources, frozen } = attribute(
      gh("##[error]tests/acceptance/244.test.ts(12,3): error TS2304: Cannot find name 'admin'."),
    );

    expect(sources).toContain("tests/acceptance/244.test.ts");
    expect(frozen).toContain("tests/acceptance/244.test.ts");
  });

  it("does not invent a file from a bare annotated message", () => {
    const { sources, raw } = attribute(gh("##[error]Process completed with exit code 2."));
    expect(sources).toEqual([]);
    expect(raw).toContain("unidentified");
  });
});

describe("the runtime plumbing", () => {
  const engineer = readFileSync(".github/workflows/factory-engineer.yml", "utf8");

  it("the Engineer calls the attributor rather than grepping the log itself", () => {
    expect(engineer).toContain("/tmp/attribute-failure.sh");
    expect(engineer).not.toContain("grep -oE 'tests/acceptance/[A-Za-z0-9._/-]+'");
  });

  it("materialises it, because a factory branch may predate the script", () => {
    expect(engineer).toContain("git show origin/main:scripts/factory/attribute-failure.sh");
  });

  it("has something to say when attribution fails", () => {
    expect(engineer).toContain("could not be attributed");
  });
});

describe("the format the script is actually fed", () => {
  // gh run view --log-failed, not a bare timestamped log. Every expression in
  // the normalisation chain is ^-anchored, so each only fires once the prefixes
  // outside it are gone — which makes their ORDER load-bearing and silent when
  // wrong.
  it("attributes a tsc diagnostic behind job/step tabs and a workflow command", () => {
    // The exact line from #359, which the block comment reported as
    // unattributable while quoting it verbatim two paragraphs above.
    const { sources } = attribute(
      [
        ghFailedLog("> tsc --noEmit"),
        ghFailedLog(
          "##[error]src/app/settings/settings-client.tsx(153,8): error TS17008: JSX element 'div' has no corresponding closing tag.",
        ),
        ghFailedLog("##[error]Process completed with exit code 2."),
      ].join("\n"),
    );

    expect(
      sources,
      "the log names the file, the line and the TS code — reporting this as unattributable costs a human round-trip",
    ).toEqual(["src/app/settings/settings-client.tsx"]);
  });

  it("attributes a vitest failure behind the same prefixes", () => {
    const { sources } = attribute(
      ghFailedLog(
        `${fail("tests/regression/live-checks.test.ts > the live RLS check > selects it")}`,
        "Run npm test",
      ),
    );
    expect(sources).toEqual(["tests/regression/live-checks.test.ts"]);
  });

  it("still attributes a log with no tab prefix", () => {
    // Not every caller pipes --log-failed. Fixing one format must not break the
    // other, which is the trap in a chain of anchored substitutions.
    const { sources } = attribute(
      gh(
        "##[error]src/app/settings/settings-client.tsx(153,8): error TS17008: JSX element 'div' has no corresponding closing tag.",
      ),
    );
    expect(sources).toEqual(["src/app/settings/settings-client.tsx"]);
  });
});
