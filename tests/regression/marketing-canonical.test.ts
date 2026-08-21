import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { describe, expect, it } from "vitest";

// The marketing copy is served from two domains while motko.co.uk comes up, so
// the landing page carries a canonical pointing at its new home. Exactly one
// route may do that. A canonical is a strong signal to consolidate two URLs
// into one, and the capability URLs (/q, /c, /i) are live links sitting in
// customers' inboxes — one pointing anywhere but at itself would be worse than
// the duplicate-content problem this solves.

const MARKETING_PAGE = "src/app/(marketing)/page.tsx";

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
};

describe("the marketing canonical", () => {
  it("points the landing page at motko.co.uk", () => {
    const page = readFileSync(MARKETING_PAGE, "utf8");
    expect(page).toContain('const MARKETING_CANONICAL_URL = "https://motko.co.uk"');
    expect(page).toContain("alternates: { canonical: MARKETING_CANONICAL_URL }");
  });

  it("is the only canonical declared anywhere under src/app", () => {
    const declaring = sourceFiles("src/app").filter((file) =>
      /alternates\s*:/.test(readFileSync(file, "utf8")),
    );

    expect(declaring).toEqual([MARKETING_PAGE]);
  });

  it("is not inherited from the root layout", () => {
    // Metadata merges down the layout tree, so a canonical on the root layout
    // would reach every route in the app, capability URLs included.
    const rootLayout = readFileSync("src/app/layout.tsx", "utf8");
    expect(rootLayout).not.toMatch(/alternates\s*:/);
  });

  it("leaves the legal pages canonical on motko.app", () => {
    // The app links to these directly, so they stay where the app expects them.
    for (const page of ["src/app/privacy/page.tsx", "src/app/support/page.tsx"]) {
      expect(readFileSync(page, "utf8")).not.toMatch(/alternates\s*:/);
    }
  });

  it("leaves the capability URLs declaring no metadata at all", () => {
    for (const route of ["src/app/q/[id]", "src/app/c/[id]", "src/app/i/[id]"]) {
      for (const file of sourceFiles(route)) {
        const source = readFileSync(file, "utf8");
        expect(source).not.toMatch(/alternates\s*:/);
        expect(source).not.toMatch(/canonical/);
      }
    }
  });
});
