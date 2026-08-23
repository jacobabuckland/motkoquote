import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { describe, expect, it } from "vitest";

// The marketing copy used to be served from motko.app as well as motko.co.uk,
// and the landing page carried a canonical pointing at its new home while both
// were live. That landing page is gone: motko.app/ redirects now and renders
// nothing, so NOTHING in this app should declare a canonical at all.
//
// The guard outlives the canonical it was written for. A canonical is a strong
// signal to consolidate two URLs into one, and the capability URLs (/q, /c, /i)
// are live links sitting in customers' inboxes — one pointing anywhere but at
// itself would send a customer's quote to a page that is not their quote.

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
  it("is declared nowhere under src/app, now the landing page has gone", () => {
    const declaring = sourceFiles("src/app").filter((file) =>
      /alternates\s*:/.test(readFileSync(file, "utf8")),
    );

    expect(declaring).toEqual([]);
  });

  it("has no landing page left on motko.app to carry one", () => {
    // The root renders nothing and every branch redirects, so there is no page
    // here to be a duplicate of motko.co.uk in the first place.
    const root = readFileSync("src/app/(marketing)/page.tsx", "utf8");
    expect(root).not.toMatch(/alternates\s*:/);
    expect(root).not.toMatch(/canonical/);
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
