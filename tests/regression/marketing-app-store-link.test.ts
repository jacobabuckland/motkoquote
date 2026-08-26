import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// motko is an iOS app, and for a while there was no route to it anywhere on
// the internet.
//
// The download button was removed from the motko.app landing page deliberately
// — tests/regression/app-store-link.test.ts holds that app to zero App Store
// references, so a plausible-but-wrong link cannot ship from there. The plan
// was that motko.co.uk would carry it instead. That half was never built, and
// a comment in that test asserted it had been, so nothing surfaced the gap:
// the marketing site's only calls to action pointed at motko.app, which is the
// product's web sign-in, not a download.
//
// So a trade following a referral link from another trade landed on a page
// describing "the mobile app for independent tradespeople" with no way to get
// it. These tests hold that route open.
const siteDir = "site";
const homepage = (): string => readFileSync(join(siteDir, "index.html"), "utf8");

describe("the marketing site offers the app", () => {
  it("links to the App Store listing", () => {
    // The one place in either codebase that names this URL. If the listing
    // moves, site/index.html is the only line to change.
    expect(
      homepage(),
      "motko.co.uk is the only route to the app — without this link there is none",
    ).toMatch(/https:\/\/apps\.apple\.com\/\S*\/id\d+/);
  });

  it("names the action as a download rather than as a sign-in", () => {
    // Both CTAs used to read "Get started" and both went to motko.app. A
    // visitor cannot tell an app download from a web login by destination, so
    // the label has to do it.
    expect(homepage()).toMatch(/App Store/);
  });

  it("keeps a web route for someone without an iPhone", () => {
    // Adding the download must not remove the only path for a trade on
    // Android, on a desktop, or already holding an account.
    expect(homepage()).toContain("https://motko.app");
  });
});

describe("what must never appear here", () => {
  it("never links to an App Store search", () => {
    // The defect this whole convention exists to prevent, recorded in
    // src/lib/app-store-link.ts: "A visitor who taps 'Download on the App
    // Store' and lands on a search results page does not conclude 'the URL is
    // misconfigured' — they conclude the product is not real."
    const source = homepage();
    expect(source).not.toMatch(/apps\.apple\.com\/\S*search/i);
    expect(source, "a search instruction is the prose form of the same defect").not.toMatch(
      /search (?:for )?["']?motko["']? (?:on|in) the app store/i,
    );
  });

  it("never offers Google Play", () => {
    // There is no android/ directory and no android block in
    // capacitor.config.ts. Naming Google Play promises a product that does not
    // exist. An earlier attempt at the in-app version of this shipped exactly
    // that.
    const source = homepage();
    expect(source).not.toMatch(/play\.google\.com/i);
    expect(source).not.toMatch(/google play/i);
  });
});

describe("the app codebase stays out of it", () => {
  it("leaves the listing URL owned by the marketing site alone", () => {
    // Belt and braces with tests/regression/app-store-link.test.ts, which
    // scans src/ for the same literal. Stated here too because the reason lives
    // here: one owner for this URL, and it is site/index.html.
    const appSideLeak = readFileSync(
      "tests/regression/app-store-link.test.ts",
      "utf8",
    );
    expect(
      appSideLeak,
      "the guard keeping apps.apple.com out of src/ must still exist",
    ).toContain("apps.apple.com");
  });
});
