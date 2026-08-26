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

  it("has no download button left in this app to get it wrong", () => {
    // The button lived on the motko.app landing page. That page is gone, and
    // the button now lives on the marketing site — `site/index.html`, which is
    // static HTML with the listing URL written literally, since it has no build
    // step and so no env vars. `tests/regression/marketing-app-store-link.test.ts`
    // holds it there.
    //
    // This comment used to claim motko.co.uk "carries the button there, behind
    // its own copy of this helper". For a while it did not carry one at all —
    // the second half of the move was never made, and stating it as fact meant
    // nothing surfaced the gap. An iOS product had no download link anywhere on
    // the internet, and this comment was the reason nobody noticed: it is the
    // stated justification for the prohibition below, so it makes that
    // prohibition sound reasoned rather than arbitrary.
    //
    // Kept in the past tense on purpose. A comment that justifies a guard by
    // describing something ELSEWHERE cannot be verified by the test it sits in,
    // and will not fail when that elsewhere changes or never arrives.
    //
    // What has to hold HERE is that nothing reintroduces the search-URL
    // fallback, which the repo-wide scan above covers, and that no caller
    // quietly reappears without one.
    const callers = sourceFiles("src").filter(
      (file) =>
        !file.includes(".test.") &&
        file !== "src/lib/app-store-link.ts" &&
        readFileSync(file, "utf8").includes("resolveAppStoreHref"),
    );

    expect(callers).toEqual([]);
  });

  it("documents the variable in .env.example", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toContain("NEXT_PUBLIC_APP_STORE_URL=");
    expect(env).toMatch(/DOES NOT RENDER/);
  });
});
