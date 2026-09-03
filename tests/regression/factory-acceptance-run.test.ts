import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The PM already ran the acceptance file it was about to freeze. What it did
// with the result was the defect: factory-pm.yml branched on the EXIT CODE
// alone, so every non-zero outcome fell through to "as required" — including a
// file that could not be loaded. #352's unresolvable import was waved through
// on exactly that path, and burned two complete cycles.
//
// The four .log fixtures are REAL vitest output, captured by running purpose-
// built files against this tree, not hand-written. A classifier whose fixtures
// are invented is a classifier tested against its author's memory of the
// format.

const CHECK = "scripts/factory/check-acceptance-run.sh";
const LOGS = "tests/fixtures/vitest-logs";

function check(spec: string, logPath: string): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-run-"));
  const specPath = join(dir, "spec.md");
  writeFileSync(specPath, spec);
  try {
    return { status: 0, out: execFileSync(CHECK, [specPath, logPath], { encoding: "utf8" }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const SPEC_DECLARING_NEW = [
  "# Issue #999: A thing",
  "",
  "## Files",
  "",
  "- `src/lib/not-yet-built-thing.ts` (new) — the thing",
  "- src/app/other/page.tsx (new) — another, written without backticks",
  "- `src/lib/existing.ts` (modify) — untouched",
  "",
  "## Edge cases",
  "",
].join("\n");

const SPEC_WITH_NO_FILES = "# Issue #999: A thing\n\nNo files section at all.\n";

describe("a file that could not be loaded", () => {
  it("blocks when the unresolved import is under tests/", () => {
    // The #352 re-derive, exactly: an unresolvable path with the wrong
    // extension that took the whole acceptance file down.
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/load-failure-test-path.log`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::no-tests-executed::");
  });

  it("names the specifier it objected to", () => {
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/load-failure-test-path.log`);
    expect(r.out).toContain("signup-referral-field.test");
  });

  it("blocks when the spec declares no new files at all", () => {
    // An item creating no new files has nothing whose absence is expected, so
    // any "no tests" outcome is a defect.
    const r = check(SPEC_WITH_NO_FILES, `${LOGS}/load-failure-new-source.log`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::no-tests-executed::");
  });
});

describe("a file whose subject does not exist yet", () => {
  it("passes when the unresolved import is a file the spec declares (new)", () => {
    // The distinction that had to be got right rather than guessed. An
    // acceptance test for a brand-new component top-level-imports that
    // component, so before implementation it produces the IDENTICAL "no tests"
    // shape as a broken path. Only the specifier tells them apart.
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/load-failure-new-source.log`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("expected-pre-implementation");
  });

  it("resolves the @/ alias against src/ before comparing", () => {
    // The log says "@/lib/not-yet-built-thing"; the spec says
    // "src/lib/not-yet-built-thing.ts". Neither the alias nor the extension
    // may defeat the match.
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/load-failure-new-source.log`);
    expect(r.out).toContain("src/lib/not-yet-built-thing.ts");
  });

  it("reads a Files entry written without backticks", () => {
    const spec = [
      "# Issue #999",
      "",
      "## Files",
      "",
      "- src/lib/not-yet-built-thing.ts (new) — no backticks here",
      "",
    ].join("\n");
    const r = check(spec, `${LOGS}/load-failure-new-source.log`);
    expect(r.status).toBe(0);
  });

  it("does not treat a (modify) entry as a licence to be missing", () => {
    // A file the spec says already exists cannot legitimately fail to resolve.
    const spec = [
      "# Issue #999",
      "",
      "## Files",
      "",
      "- `src/lib/not-yet-built-thing.ts` (modify) — already exists, allegedly",
      "",
    ].join("\n");
    const r = check(spec, `${LOGS}/load-failure-new-source.log`);
    expect(r.status).toBe(1);
  });

  it("stops reading Files at the next section heading", () => {
    // A path mentioned under Edge cases is discussion, not a declaration.
    const spec = [
      "# Issue #999",
      "",
      "## Files",
      "",
      "- `src/lib/something-else.ts` (new) — the real one",
      "",
      "## Edge cases",
      "",
      "- `src/lib/not-yet-built-thing.ts` (new) — only discussed here",
      "",
    ].join("\n");
    const r = check(spec, `${LOGS}/load-failure-new-source.log`);
    expect(r.status).toBe(1);
  });
});

describe("a dynamic route the spec declares, which is the shape App Router uses", () => {
  // #522 was blocked twice and #521 once on correct failing-first tests, by two
  // stacked defects in this check. Vite's import-analysis plugin phrases an
  // unresolved import as `Failed to resolve import "x" from "y"`, which matched
  // none of the patterns the specifier extractor knew — so it found no
  // specifier and reported "the log names no unresolved import" while the log
  // named one in full. And the ## Files filter excluded [ and ], so every
  // dynamic-route file was silently dropped from the declared list and could
  // never be matched even once the specifier was found.
  //
  // The fixture is real vitest output, captured by running a file that imports
  // a page that does not exist, per the convention above.
  const SPEC_DECLARING_DYNAMIC_ROUTE = [
    "# Issue #999: A run viewer",
    "",
    "## Files",
    "",
    "- `src/app/jobs/[id]/run/page.tsx` (new) — the viewer",
    "",
    "## Edge cases",
    "",
  ].join("\n");

  it("passes, because the unresolved import is the file the spec is creating", () => {
    const { status, out } = check(
      SPEC_DECLARING_DYNAMIC_ROUTE,
      `${LOGS}/resolve-failure-new-source.log`,
    );
    expect(out).toContain("expected-pre-implementation");
    expect(status).toBe(0);
  });

  it("still blocks when the spec does not declare that route", () => {
    const { status, out } = check(SPEC_WITH_NO_FILES, `${LOGS}/resolve-failure-new-source.log`);
    expect(out).toContain("::no-tests-executed::");
    expect(out).toContain("@/app/jobs/[id]/run/page");
    expect(status).toBe(1);
  });
});

describe("a test that ran", () => {
  it("passes on an assertion failure", () => {
    // The expected state for an item modifying existing behaviour.
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/assertion-failure.log`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("ran-and-failed");
  });

  it("blocks when every test passed", () => {
    // #315 froze thirty tests that all passed on a clean tree — the work was
    // already shipped. This guard is the only reason two more agent runs were
    // not spent rebuilding it.
    const r = check(SPEC_DECLARING_NEW, `${LOGS}/all-passed.log`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::tests-all-passed::");
  });
});

describe("a log it cannot read", () => {
  it("blocks rather than returning fine", () => {
    // A classifier that returns "fine" on an outcome it did not understand is
    // the defect being fixed, one level up.
    const dir = mkdtempSync(join(tmpdir(), "acceptance-run-"));
    const logPath = join(dir, "garbage.log");
    writeFileSync(logPath, "the runner died before printing a summary\n");
    const r = check(SPEC_DECLARING_NEW, logPath);
    expect(r.status).toBe(1);
    expect(r.out).toContain("::unreadable-log::");
  });

  it("exits 2 distinctly when a file argument is missing", () => {
    try {
      execFileSync(CHECK, ["docs/specs/does-not-exist.md", `${LOGS}/all-passed.log`], {
        encoding: "utf8",
      });
      throw new Error("expected a non-zero exit");
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(2);
      expect(e.stderr ?? "").toContain("not found");
    }
  });
});

// Every fixture above was captured by running vitest in this container, which
// is not a TTY - so none of them carries colour. That is precisely why the
// following defect survived the classifier's own test suite.
//
// Vitest colourises its summary whenever it believes the terminal supports it,
// and GitHub Actions does. The line then arrives with the escape sequence
// BEFORE the leading whitespace:
//
//   <ESC>[2m      Tests <ESC>[22m <ESC>[1m<ESC>[31m12 failed...
//
// which an anchored `^[[:space:]]*Tests` cannot match. So in CI - and only in
// CI, which is the only place it runs - the classifier saw no summary line on
// ANY run and returned ::unreadable-log:: for all of them.
//
// That is not one item blocked. It is every item blocked at the PM stage, with
// the verdict that is hardest to argue with: "nothing in the file executed".
//
// #403 paid for it twice. Its acceptance file ran twelve tests and failed all
// twelve for exactly the right reasons - three real assertion failures plus
// `formatWhatsLeftResponse is not a function`, the function the item exists to
// specify. That is the required pre-implementation failure, and it was blocked
// as though nothing had run.
//
// The fixture below is transcribed byte-for-byte from that run's log
// (run 33203555698, job 98958774510). It is real output, not a reconstruction
// from memory of the format - it just could not be captured by running vitest
// here, because here it comes out uncoloured.
describe("a colourised log, which is the only kind CI produces", () => {
  it("is classified by what it says, not by whether it is coloured", () => {
    const { status, out } = check(
      SPEC_DECLARING_NEW,
      `${LOGS}/ran-and-failed-colourised.log`,
    );

    expect(out).toContain("ran-and-failed");
    expect(out).toContain("Tests  12 failed (12)");
    expect(status).toBe(0);
    // The verdict that blocked #403 twice must not appear.
    expect(out).not.toContain("::unreadable-log::");
  });

  it("reads the same summary out of coloured and uncoloured logs", () => {
    const coloured = check(SPEC_DECLARING_NEW, `${LOGS}/ran-and-failed-colourised.log`);
    const plain = check(SPEC_DECLARING_NEW, `${LOGS}/assertion-failure.log`);

    // Both are runs that executed and failed. Colour is presentation; it must
    // not change the verdict.
    expect(coloured.status).toBe(plain.status);
    expect(coloured.out).toContain("ran-and-failed");
    expect(plain.out).toContain("ran-and-failed");
  });

  it("still reports a genuinely unreadable log as unreadable", () => {
    // Stripping colour must not turn the safety verdict into a rubber stamp:
    // a log with no summary line at all is still not something to wave through,
    // even when it is colourised.
    const dir = mkdtempSync(join(tmpdir(), "acceptance-run-noline-"));
    const logPath = join(dir, "vitest.log");
    writeFileSync(logPath, "\u001b[31msomething exploded before any summary\u001b[39m\n");

    const { status, out } = check(SPEC_DECLARING_NEW, logPath);

    expect(out).toContain("::unreadable-log::");
    expect(status).toBe(1);
  });
});
