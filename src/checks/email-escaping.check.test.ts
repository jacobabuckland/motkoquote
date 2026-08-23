import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const appFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...appFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
};

// Checker rule (Batch 4 — email rendering): every value interpolated into an
// email's HTML must pass through escapeHtml. Resend sends raw HTML strings with
// no JSX auto-escaping, so a bare `${input.x}` in the markup is an injection
// sink (M2/#3). This scan fails if any known outside-origin field is emitted
// unescaped, or if the JSON-LD sink drops its `</script>` hardening.
const root = (p: string) => join(process.cwd(), p);

describe("email HTML interpolations are escaped", () => {
  const src = readFileSync(root("src/lib/email.ts"), "utf8");

  it("imports the escapeHtml helper", () => {
    expect(src).toContain('from "@/lib/escape-html"');
  });

  // Outside-origin values that ONLY ever appear in HTML bodies. A raw
  // `${input.field}` (not wrapped in escapeHtml) is a regression. The regex only
  // matches the un-escaped form — `${escapeHtml(input.field)}` starts with
  // `${escapeHtml(`, not `${input.`, so escaped uses correctly produce no match.
  const htmlOnlyFields = [
    "customerName",
    "heading",
    "nextStep",
    "buttonLabel",
    "purgeDate",
    "quoteUrl",
    "contractUrl",
    "paymentUrl",
    "jobUrl",
    "body",
  ];

  for (const field of htmlOnlyFields) {
    it(`never interpolates input.${field} without escaping`, () => {
      // Any `${input.field …}` interpolation must carry an escapeHtml( call —
      // both direct emits and ternaries whose branch escapes the value. A bare
      // `${input.field}` (raw content) has no escapeHtml( and fails.
      for (const match of src.match(new RegExp(`\\$\\{input\\.${field}\\b[^}]*\\}`, "g")) ?? []) {
        expect(match).toContain("escapeHtml(");
      }
    });
  }

  // companyName is dual-use: plain-text SUBJECT lines (no escaping needed) and
  // HTML bodies (must be escaped). Scope the check to the HTML occurrence, which
  // is always preceded by a tag boundary (`>${…}`); a raw one has no escapeHtml.
  it("escapes companyName where it lands in HTML (subjects are plain text)", () => {
    for (const match of src.match(/>\$\{input\.companyName\b[^}]*\}/g) ?? []) {
      expect(match).toContain("escapeHtml(");
    }
  });
});

// The JSON-LD sink lived on the motko.app landing page, which is gone: the
// marketing copy is motko.co.uk's now and the root here only redirects. The
// guard outlives the page — if anyone reintroduces a ld+json script, it has to
// escape `<` or a stray "</script>" in any field breaks out of the element.
describe("JSON-LD sink is hardened against </script> breakout", () => {
  it("has no unescaped ld+json sink anywhere under src", () => {
    const offenders = appFiles("src").filter((file) => {
      // Tests name the sink in order to look for it; scanning them finds only
      // this file, every time.
      if (file.includes(".test.")) return false;
      const src = readFileSync(file, "utf8");
      if (!src.includes("application/ld+json")) return false;
      return !/\.replace\(\/<\/g, "\\\\u003c"\)/.test(src);
    });

    expect(offenders).toEqual([]);
  });
});
