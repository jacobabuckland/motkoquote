import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppStoreHref } from "@/lib/app-store-link";

// The landing page's download button used to fall back to an App Store SEARCH
// for "Motko" whenever the listing URL was unset. It always rendered and always
// looked like a working link, and anyone who tapped it landed on search results
// and concluded the product wasn't real. These tests hold the fallback gone and
// hold "absent rather than plausible" as the behaviour.

describe("resolveAppStoreHref", () => {
  it("returns a configured listing URL unchanged", () => {
    const url = "https://apps.example.test/gb/app/motko/id123456789";
    expect(resolveAppStoreHref(url)).toBe(url);
  });

  it("renders nothing when unset", () => {
    expect(resolveAppStoreHref(undefined)).toBeNull();
  });

  it("renders nothing for an empty string", () => {
    expect(resolveAppStoreHref("")).toBeNull();
  });

  it("renders nothing for whitespace", () => {
    expect(resolveAppStoreHref("   \t\n ")).toBeNull();
  });

  it("renders nothing for a non-URL string", () => {
    expect(resolveAppStoreHref("coming soon")).toBeNull();
    expect(resolveAppStoreHref("motko")).toBeNull();
  });

  it("renders nothing for a non-http scheme", () => {
    expect(resolveAppStoreHref("javascript:alert(1)")).toBeNull();
    expect(resolveAppStoreHref("itms-apps://example.test/app/id1")).toBeNull();
  });

  it("never repairs a half-right value into a link", () => {
    // No protocol prepended, no path appended. Repairing a nearly-right value
    // is how a wrong link ships with confidence.
    expect(resolveAppStoreHref("apps.example.test/gb/app/motko/id1")).toBeNull();
  });

  it("trims surrounding whitespace rather than rejecting the value", () => {
    expect(resolveAppStoreHref("  https://apps.example.test/id1  ")).toBe(
      "https://apps.example.test/id1",
    );
  });
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
  });

describe("the search-URL fallback is gone", () => {
  it("leaves no apps.apple.com literal anywhere in src/", () => {
    const offenders = sourceFiles("src").filter((file) =>
      readFileSync(file, "utf8").includes("apps.apple.com"),
    );

    expect(offenders).toEqual([]);
  });

  it("derives the href from the environment and nothing else", () => {
    const page = readFileSync("src/app/(marketing)/page.tsx", "utf8");
    expect(page).toContain(
      "const APP_STORE_HREF = resolveAppStoreHref(process.env.NEXT_PUBLIC_APP_STORE_URL)",
    );
    // The `??` fallback is what made the bad state reachable.
    expect(page).not.toMatch(/NEXT_PUBLIC_APP_STORE_URL\s*\?\?/);
  });

  it("gates the whole block, so nothing is orphaned when the button is absent", () => {
    // Gating only the <a> would leave "Prefer an app?" captioning nothing, and
    // the wrapper's mt-6 as a gap where a button used to be.
    const page = readFileSync("src/app/(marketing)/page.tsx", "utf8");
    expect(page).toContain("{APP_STORE_HREF && (");
    expect(page).toContain("<AppStoreButton href={APP_STORE_HREF} />");
  });

  it("keeps the button's existing link hygiene", () => {
    const page = readFileSync("src/app/(marketing)/page.tsx", "utf8");
    expect(page).toContain('target="_blank"');
    expect(page).toContain('rel="noopener noreferrer"');
    expect(page).toContain('aria-label="Download Motko on the App Store"');
  });

  it("documents the variable in .env.example", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toContain("NEXT_PUBLIC_APP_STORE_URL=");
    expect(env).toMatch(/DOES NOT RENDER/);
  });
});
