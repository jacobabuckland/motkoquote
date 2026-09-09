import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The shell and the web must agree about who applies the top inset.
 *
 * There are exactly two coherent states, and the bug is being in neither:
 *
 *   contentInset "never"  + web applies env()   ← this one
 *   contentInset "always" + web zeroes the token
 *
 * On 30 Aug both halves of the SECOND state were written in one commit. Only
 * the web half can deploy: a native config needs a new binary, and none was
 * built — the 8 Sep Podfile work recorded `cap sync` skipping `pod install`
 * and `xcodebuild`, so the App Store binary still predates it.
 *
 * So the tree said "always" while every install said "never", the token was
 * zero inside a shell that does not inset, and every top bar fell back to its
 * bare 1rem — which does not clear a 54pt status bar. The guest "Sign in" link
 * went back under the battery indicator: the ORIGINAL defect --safe-top was
 * introduced to fix, photographed on a fresh App Store install on 9 Sep.
 *
 * The device evidence that settles which state we are actually in: the 26 Aug
 * measurement recorded the native #004225 container visible from y=0 to y=186
 * while the shell was insetting. On the 9 Sep photo that strip is CREAM — the
 * page background runs to the physical top. The shell does not inset.
 *
 * This pins the two halves together so they cannot drift apart again, which is
 * the only reason the defect was invisible for ten days.
 */

const read = (path: string) => readFileSync(resolve(__dirname, "../..", path), "utf8");

/**
 * Comments stripped before matching, in both files.
 *
 * Both explain the removed override BY NAME — they have to, it is the whole
 * history — so a regex over the raw text finds the rule in the prose that says
 * it is gone, and the test fails against the correct implementation. That is
 * the over-matching AGENTS.md warns about, and it caught this file on its
 * first run.
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const css = stripComments(read("src/app/globals.css"));
const capacitorConfig = stripComments(read("capacitor.config.ts")).replace(
  /\/\/[^\n]*/g,
  "",
);

describe("the native shell does not inset", () => {
  it("declares contentInset: never", () => {
    expect(capacitorConfig).toMatch(/contentInset:\s*"never"/);
  });

  it("does not ask the shell to inset, which would double with a cover viewport", () => {
    expect(capacitorConfig).not.toMatch(/contentInset:\s*"always"/);
  });
});

describe("so the web applies the whole inset, everywhere", () => {
  it("defines the token as the real notch", () => {
    expect(css).toMatch(/--safe-top:\s*env\(safe-area-inset-top\)/);
  });

  it("never zeroes it for the native shell", () => {
    // The compensation that could only ever be right for a binary that does
    // not exist. Its removal IS this fix.
    expect(css).not.toMatch(/\.native-app\s*\{[^}]*--safe-top:\s*0px/);
  });
});

describe("the pairing holds as one state", () => {
  it("never combines an insetting shell with a web that also insets", () => {
    // The doubling. Either half alone is fine; together they are the 26 Aug
    // defect, measured at 124 CSS px where 62 was correct.
    const shellInsets = /contentInset:\s*"always"/.test(capacitorConfig);
    const webZeroesToken = /\.native-app\s*\{[^}]*--safe-top:\s*0px/.test(css);
    expect(shellInsets && !webZeroesToken).toBe(false);
  });

  it("never combines a non-insetting shell with a web that zeroes the token", () => {
    // The underlap, and the state the app was actually shipped in: nobody
    // applies the inset and the Sign in link sits under the battery.
    const shellInsets = /contentInset:\s*"always"/.test(capacitorConfig);
    const webZeroesToken = /\.native-app\s*\{[^}]*--safe-top:\s*0px/.test(css);
    expect(!shellInsets && webZeroesToken).toBe(false);
  });
});
