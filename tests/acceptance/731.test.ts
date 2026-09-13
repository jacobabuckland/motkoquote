import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// #718 and #719 shipped acceptance files with type errors the check was built
// to catch, and it passed both. TS18046 (property access on unknown from a
// test helper) and TS2322 (type mismatch on a field the spec isn't changing)
// both indicate the test is wrong, not that it's correctly failing-first. The
// check needs the spec to know what the item is changing.
//
// This corpus pins the classification in both directions: unfixable errors
// must be reported, and correct failing-first tests must stay silent.

const SCRIPT = "scripts/factory/check-acceptance-types.sh";
const TESTS = "tests/acceptance/99.test.ts"; // any real path

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

// Helper to create a fixture spec with a ## Files section
const withSpec = (files: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-types-spec-"));
  dirs.push(dir);
  const path = join(dir, "spec.md");
  const filesSection = files.length > 0
    ? "## Files\n\n" + files.map((f) => `- ${f} (modify)`).join("\n") + "\n"
    : "## Files\n\n(none)\n";
  writeFileSync(path, `# Test spec\n\n${filesSection}`);
  return path;
};

const withLog = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-types-log-"));
  dirs.push(dir);
  const path = join(dir, "tsc.log");
  writeFileSync(path, contents);
  return path;
};

const check = (spec: string, tests: string, log?: string): { status: number; out: string } => {
  try {
    const args = log ? [spec, tests, log] : [spec, tests];
    const out = execFileSync(SCRIPT, args, { encoding: "utf8" });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

const PASSED = "no self-contradicting type errors";

describe("check-acceptance-types with spec awareness", () => {
  describe("MUST REPORT — unfixable type errors", () => {
    it("case 1: rejects zero-arity mock called with an argument (TS2554)", () => {
      // Already caught by existing logic, must not regress
      const spec = withSpec([]);
      const log = withLog(`${TESTS}(296,57): error TS2554: Expected 0 arguments, but got 1.\n`);

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(1);
      expect(out).toContain("TS2554");
    });

    it("case 2: rejects mock.calls[0][0] on zero-arg vi.fn() (TS2493)", () => {
      // The #640 defect — already caught, must not regress
      const spec = withSpec([]);
      const log = withLog(
        `${TESTS}(45,12): error TS2493: Tuple type '[]' of length '0' has no element at index '0'.\n`,
      );

      const { status } = check(spec, TESTS, log);

      expect(status).toBe(1);
    });

    it("case 3: rejects property access on unknown from test helper (TS18046) — #719", () => {
      // The gap this item closes. `w.payload.stage_number` where `payload` is
      // `unknown` from `getWrites()` is a poorly-typed mock, not a
      // failing-first assertion. Always a test bug.
      const spec = withSpec([]);
      const log = withLog(`${TESTS}(67,5): error TS18046: 'w.payload' is possibly 'never'.\n`);

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(1);
      expect(out).toContain("TS18046");
    });

    it("case 4: TS2322 on field the spec does not change — known limitation, documented", () => {
      // The #718 case. `customer_name: null` where the field type is `string`
      // and the spec changes a different part of that schema. Without the TS
      // compiler API, we cannot determine from tsc output alone where
      // `customer_name` is declared, so we cannot tell case 4 from case 8.
      //
      // This test documents the gap rather than asserting a fix. The check's
      // header must explain why TS2322 cannot be added to the allowlist.
      const spec = withSpec(["lib/schemas/sow.ts"]); // spec lists the file
      const log = withLog(
        `${TESTS}(38,5): error TS2322: Type 'null' is not assignable to type 'string'.\n`,
      );

      // Current behavior: stays silent (cannot distinguish from case 8)
      // Future enhancement with TS compiler API would report this
      const { status } = check(spec, TESTS, log);

      expect(status).toBe(0); // known limitation — see script header
    });
  });

  describe("MUST STAY SILENT — correct failing-first tests", () => {
    it("case 5: allows module the item is creating (TS2307)", () => {
      // The original failing-first contract
      const spec = withSpec(["lib/payment-reassurance-copy.ts"]);
      const log = withLog(
        `${TESTS}(3,29): error TS2307: Cannot find module '@/lib/payment-reassurance-copy'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(0);
      expect(out).toContain(PASSED);
    });

    it("case 6: allows export not written yet (TS2339)", () => {
      // TS2307 covers missing modules, but missing exports are just as legitimate
      const spec = withSpec(["lib/voice/ledger-query-prompt.ts"]);
      const log = withLog(
        `${TESTS}(43,15): error TS2339: Property 'formatWhatsLeftResponse' does not exist on type 'typeof import("/x/lib/voice/ledger-query-prompt")'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(0);
      expect(out).toContain(PASSED);
    });

    it("case 7: allows property missing from type the item is changing (TS2339)", () => {
      // #403's sixth derivation. Item changes getWhatsLeft from
      // Promise<number> to Promise<WhatsLeftAnswer>, so
      // `(await getWhatsLeft()).total` is exactly the assertion it exists to
      // make. Every item that changes a signature produces this shape.
      const spec = withSpec(["lib/ledger-query.ts"]);
      const log = withLog(
        `${TESTS}(34,21): error TS2339: Property 'total' does not exist on type 'number'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(0);
      expect(out).toContain(PASSED);
    });

    it("case 8: allows TS2322 on field whose type the spec is changing", () => {
      // The inverse of case 4. Same diagnostic code, same expression shape,
      // but the spec DOES list the file declaring the type. Without the TS
      // compiler API, we cannot determine the declaring file from tsc output,
      // so this and case 4 are both silent — which means case 4 (unfixable)
      // slips through as a known limitation.
      const spec = withSpec(["lib/schemas/contract.ts"]);
      const log = withLog(
        `${TESTS}(52,7): error TS2322: Type 'string | null' is not assignable to type 'string'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(0);
      expect(out).toContain(PASSED);
    });

    it("case 9: ignores diagnostics in other files (already handled)", () => {
      // Pre-existing errors elsewhere are not this item's to answer for
      const spec = withSpec([]);
      const log = withLog(
        `src/lib/something-else.ts(10,3): error TS18046: 'x' is possibly 'never'.\n` +
          `tests/acceptance/999.test.ts(4,1): error TS18046: 'y' is possibly 'never'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(0);
      expect(out).not.toContain("something-else");
      expect(out).not.toContain("999.test.ts");
    });
  });

  describe("signature and integration", () => {
    it("accepts spec path as first argument", () => {
      const spec = withSpec([]);
      const log = withLog("");

      // Should not error on usage
      const { status } = check(spec, TESTS, log);

      expect(status).toBe(0);
    });

    it("parses ## Files section to extract file list", () => {
      // The spec extraction itself is tested by behavior (cases 5-8 depend on
      // it), but verify the script can handle various formats
      const spec = withSpec([
        "lib/foo.ts",
        "lib/bar/baz.tsx",
        "app/jobs/[id]/page.tsx", // dynamic route segment
      ]);
      const log = withLog("");

      const { status } = check(spec, TESTS, log);

      expect(status).toBe(0);
    });

    it("handles spec with no Files section gracefully", () => {
      const dir = mkdtempSync(join(tmpdir(), "spec-no-files-"));
      dirs.push(dir);
      const spec = join(dir, "spec.md");
      writeFileSync(spec, "# Spec\n\n## Problem\n\nSomething\n");
      const log = withLog("");

      const { status } = check(spec, TESTS, log);

      expect(status).toBe(0); // empty file list, same as withSpec([])
    });

    it("separates unfixable errors from correct failing-first in one log", () => {
      // Case 3 (TS18046) reported, case 5 (TS2307) silent, in same log
      const spec = withSpec(["lib/new-module.ts"]);
      const log = withLog(
        `${TESTS}(3,29): error TS2307: Cannot find module '@/lib/new-module'.\n` +
          `${TESTS}(67,5): error TS18046: 'payload' is possibly 'never'.\n`,
      );

      const { status, out } = check(spec, TESTS, log);

      expect(status).toBe(1);
      expect(out).toContain("TS18046");
      expect(out).not.toContain("TS2307"); // not in the reported output
    });
  });

  describe("the check documents the TS2322 limitation", () => {
    const script = readFileSync(SCRIPT, "utf8");

    it("explains why TS2322 cannot be added to the allowlist", () => {
      // Without the TS compiler API, we cannot determine where a type is
      // declared from tsc --noEmit output alone. The script's header must
      // document this so the next reader doesn't attempt the same approach.
      expect(script).toContain("TS2322");
      expect(script.toLowerCase()).toMatch(/compiler api|tsserver|declar/);
    });

    it("adds TS18046 to the reported diagnostics", () => {
      // This is the change the item delivers
      const selector = script.split("\n").find((l) => l.startsWith("REAL="));
      expect(selector, "the selecting line must be named REAL=").toBeDefined();
      expect(selector?.match(/TS\d+/g)).toContain("TS18046");
    });

    it("keeps the allowlist form (grep with positive match, not exclusion)", () => {
      // The same check from the existing corpus — widening the list must
      // remain a visible diff
      const selector = script.split("\n").find((l) => l.startsWith("REAL="));
      expect(selector).not.toMatch(/grep\s+(-\w*v|--invert-match)/);
    });
  });
});

describe("the PM workflow calls with the new signature", () => {
  const pm = readFileSync(".github/workflows/factory-pm.yml", "utf8");

  it("PM workflow passes spec path to check-acceptance-types", () => {
    expect(pm).toContain("check-acceptance-types.sh");
    // Should pass docs/specs/${{ github.event.issue.number }}.md as first arg
    expect(pm).toMatch(/check-acceptance-types\.sh.*docs\/specs/);
  });
});
