import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// AGENTS.md forbids asserting on source text. Five acceptance tests did it
// anyway across #351, #356 and #359 in two days, each costing a full factory
// cycle, and the rule had nothing enforcing it at PM time — by which point the
// test is frozen and nobody downstream may repair it.
//
// The sibling rule, no importing one test file from another, lives here rather
// than on its own item: it is the same static scan of the same file at the same
// moment, and two items each adding a rule to one script is an ordering
// constraint nobody writes down.

const CHECK = "scripts/factory/check-acceptance-static.sh";

function check(source: string, name = "acceptance.test.ts"): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-static-"));
  const testPath = join(dir, name);
  writeFileSync(testPath, source);
  try {
    return { status: 0, out: execFileSync(CHECK, [testPath], { encoding: "utf8" }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("a test that reads source under src/", () => {
  it("is rejected when the path sits inside the read call", () => {
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const source = readFileSync("src/app/settings/page.tsx", "utf8");',
        'it("orders the sections", () => { expect(source.indexOf("A")).toBeLessThan(1); });',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::source-text-read::");
  });

  it("is rejected when the path is built a line above the read", () => {
    // The shape of #306, #351 and #356 — and the shape the first version of
    // this check missed entirely, because it only looked one line at a time.
    // A matcher that catches the careless half and misses the tidy half is
    // missing the wrong half.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'import { resolve } from "node:path";',
        'const componentPath = resolve(process.cwd(), "src/app/settings/referral-section.tsx");',
        'const source = readFileSync(componentPath, "utf-8");',
        'it("states the reward", () => { expect(source).toContain("+3"); });',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::source-text-read::");
  });

  it("is rejected when the path is split into separate segments", () => {
    // The shape #601 froze. Every segment is its own string literal, so a
    // matcher requiring `src/` and an extension inside ONE quoted string sees
    // nothing at all.
    const r = check(
      [
        'const fs = await import("node:fs");',
        'const path = await import("node:path");',
        'const filePath = path.join(process.cwd(), "src", "lib", "referral-signup.ts");',
        'const content = fs.readFileSync(filePath, "utf-8");',
        'it("says three", () => { expect(content).toContain("defaults to 3"); });',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::source-text-read::");
  });

  it("is rejected when the read is shelled out to git grep", () => {
    // The shape #599 froze. A source read performed by git rather than by
    // node — no readFileSync anywhere in the file.
    const r = check(
      [
        'const { execSync } = await import("node:child_process");',
        'const out = execSync(\'git grep -l "createStripePayment(" -- "src/"\', { encoding: "utf-8" });',
        'it("is called once", () => { expect(out.split("\\n")).toHaveLength(1); });',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::source-text-read::");
  });

  it("accepts a test whose only 'src' is an HTML attribute", () => {
    // #196 reads native/www/offline.html and never touches src/. Its `src` is
    // the script tag's attribute, and the first draft of the split-segment rule
    // rejected it — a lone "src" is a path segment only where a path would put
    // it, after a comma or alone on a continuation line.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const html = readFileSync("native/www/offline.html", "utf-8");',
        'it("inlines its scripts", () => {',
        '  document.body.innerHTML = html;',
        '  const tags = [...document.querySelectorAll("script")];',
        '  expect(tags.every((s) => !s.getAttribute("src"))).toBe(true);',
        "});",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("clean");
  });

  it("accepts a RUNNABLE test that shells out to its entry point", () => {
    // execSync is deliberately NOT banned outright: AGENTS.md requires a
    // runnable deliverable's tests to invoke the command end to end. The
    // conjunction with a src/ path is what makes it a source read, and this
    // names scripts/, so it must stay clean or the two rules contradict.
    const r = check(
      [
        'import { execSync } from "node:child_process";',
        'it("runs", () => {',
        '  const out = execSync("npx tsx scripts/backfill/recover-fees.ts --dry-run", { encoding: "utf8" });',
        '  expect(out).toContain("0 contractors affected");',
        "});",
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("clean");
  });

  it("names the offending lines, so the fix does not need a hunt", () => {
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const source = readFileSync("src/lib/haptics.ts", "utf8");',
      ].join("\n"),
    );
    expect(r.out).toContain("readFileSync");
    expect(r.out).toContain("src/lib/haptics.ts");
  });
});

describe("a test that imports another test file", () => {
  it("is rejected for the exact specifier #352 froze", () => {
    // Unresolvable, wrong extension, and it took the whole acceptance file
    // down: the gate reported 1 failed | 202 passed test FILES with zero
    // failing tests, which is what a file that cannot be imported looks like.
    const r = check(
      'const testMod = await import("@/../../tests/regression/signup-referral-field.test");',
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::test-file-import::");
  });

  it("is rejected for a static import of a .test module", () => {
    const r = check('import { thing } from "./other.test";');
    expect(r.status).toBe(1);
    expect(r.out).toContain("::test-file-import::");
  });
});

describe("what must NOT be rejected", () => {
  it("accepts a test that renders and queries the DOM", () => {
    const r = check(
      [
        'import { render, screen } from "@testing-library/react";',
        'import { Button } from "@/components/ui/button";',
        'it("fires", () => { render(<Button />); expect(screen.getByRole("button")).toBeDefined(); });',
      ].join("\n"),
      "acceptance.test.tsx",
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("clean");
  });

  it("accepts a test that reads a fixture under tests/", () => {
    // Fixtures are test-owned data, not production source. The rule is src/
    // specifically.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const fixture = readFileSync("tests/fixtures/quote.json", "utf8");',
      ].join("\n"),
    );
    expect(r.status).toBe(0);
  });

  it("accepts a test that reads a migration", () => {
    // Asserting a migration's presence or content is a legitimate structural
    // claim about a file that is not application source.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const sql = readFileSync("supabase/migrations/00000000000048_quote_sent_total.sql", "utf8");',
      ].join("\n"),
    );
    expect(r.status).toBe(0);
  });

  it("accepts an import of application code under the @/ alias", () => {
    // Importing the thing under test is the entire point. Only test files are
    // forbidden.
    const r = check('import { formatGBP } from "@/lib/format";');
    expect(r.status).toBe(0);
  });
});

describe("the standing registries", () => {
  // Both legitimately walk src/. AGENTS.md blesses them by name as registries
  // with an intended registration path, and "never resolve a registry failure
  // by moving the thing being registered out of its view" applies with equal
  // force to the registry itself.
  it.each(["tests/acceptance/99.test.ts", "tests/acceptance/200.test.tsx"])(
    "allowlists %s",
    (path) => {
      const out = execFileSync(CHECK, [path], { encoding: "utf8" });
      expect(out).toContain("allowlisted");
    },
  );

  it("matches the allowlist on the full path, never on a pattern", () => {
    // A glob such as tests/acceptance/*registry* would let the sixth instance
    // name itself around the check. A file that merely resembles an allowlisted
    // name gets no exemption.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'const source = readFileSync("src/app/page.tsx", "utf8");',
      ].join("\n"),
      "99.test.ts",
    );
    expect(r.status).toBe(1);
  });
});

describe("both findings in one file", () => {
  it("reports both, rather than stopping at the first", () => {
    // Stopping at one costs a second cycle to surface the other, and a cycle
    // here is the expensive thing this check exists to prevent.
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'import { helper } from "../regression/other.test";',
        'const source = readFileSync("src/app/page.tsx", "utf8");',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::source-text-read::");
    expect(r.out).toContain("::test-file-import::");
  });
});

describe("bad input", () => {
  it("fails distinctly when the file does not exist", () => {
    try {
      execFileSync(CHECK, ["tests/acceptance/does-not-exist.test.ts"], { encoding: "utf8" });
      throw new Error("expected a non-zero exit");
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      expect(e.status).toBe(2);
      expect(e.stderr ?? "").toContain("not found");
    }
  });
});

// `@/*` maps to `./src/*`, so `@/../..` resolves one level ABOVE the checkout
// and can never name a file in this project. #352 froze an import of that shape
// pointing at a test file, and #475's fourth derivation froze one pointing at a
// migration — ENOENT on '/home/user/supabase/...', outside the repository.
//
// The distinction that makes this rule narrow enough to be safe: reading a
// migration is legitimate and common here — seven shipped acceptance tests do it
// via join(process.cwd(), "supabase/migrations"). The fault is never the
// migration, only the path form.
describe("an import that climbs out of the repository", () => {
  it("rejects @/../.. pointing at a migration", () => {
    const r = check(
      [
        'const migration = await import(',
        '  "@/../../supabase/migrations/00000000000054_processing_fee_columns.sql?raw"',
        ");",
        'it("has the column", () => { expect(migration.default).toContain("x"); });',
      ].join("\n"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toContain("::path-escapes-repo::");
  });

  it("accepts a migration read that resolves from the repository root", () => {
    const r = check(
      [
        'import { readFileSync } from "node:fs";',
        'import { join } from "node:path";',
        'const sql = readFileSync(join(process.cwd(), "supabase/migrations/00000000000054_x.sql"), "utf8");',
        'it("has the column", () => { expect(sql).toContain("x"); });',
      ].join("\n"),
    );
    expect(r.status).toBe(0);
    expect(r.out).toContain("clean");
  });

  it("leaves a single climb alone, which can resolve to the repository root", () => {
    const r = check(
      [
        'const cfg = await import("@/../package.json");',
        'it("has a name", () => { expect(cfg.default.name).toBeDefined(); });',
      ].join("\n"),
    );
    expect(r.status).toBe(0);
  });
});
