import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A screen with no top bar must carry the top safe-area inset itself.
 *
 * The root layout sets `viewportFit: "cover"`, so the document starts at the
 * physical top of the display and applies only `px-safe` — left and right. It
 * supplies NO top inset, and there is no other layout in the tree. So a page
 * that neither mounts a top bar nor declares the inset renders its first
 * element under the status bar.
 *
 * On an iPhone 17 that put the sign-in button behind the battery indicator with
 * no way to tap it, which at launch — when every user is a fresh install — locks
 * a trade out of the product entirely.
 *
 * TWO WAYS TO SATISFY THIS, and both count:
 *   • mount AppHeader or PageHeader, which carry the inset themselves
 *     (tests/regression/top-bar-safe-area.test.tsx pins that), or
 *   • declare it directly — `pt-page-safe`, `pt-safe`, or `var(--safe-top)`.
 *
 * ALWAYS THE TOKEN, NEVER env(). `--safe-top` is env(safe-area-inset-top) on the
 * web and 0px inside the Capacitor shell, because `ios.contentInset: "always"`
 * has already inset the web view while `viewportFit: "cover"` keeps env()
 * reporting the full notch inside it. Using env() here re-applies an inset that
 * is already there — measured doubled to the pixel on an iPhone 16 Pro on
 * 26 Aug 2026. The reasoning is written out at the token in globals.css.
 *
 * WHY THIS TEST READS SOURCE. These are server components spanning data
 * fetching and auth redirects; rendering all 27 of them to inspect a padding
 * value is not available here, and happy-dom resolves neither env() nor custom
 * properties, so a computed pixel assertion would prove nothing either. The
 * property worth pinning is that the inset is DECLARED at all — which is a fact
 * about the file. tests/regression/top-bar-safe-area.test.tsx reads source for
 * the same reason and set the precedent.
 */

const APP_DIR = resolve(__dirname, "../../src/app");

const pagesRenderingBareMain = (): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx") continue;
      if (readFileSync(full, "utf8").includes("<main")) {
        found.push(relative(APP_DIR, full));
      }
    }
  };
  walk(APP_DIR);
  return found.sort();
};

const carriesTopInset = (relPath: string): boolean => {
  const source = readFileSync(join(APP_DIR, relPath), "utf8");
  const mountsATopBar = /\b(AppHeader|PageHeader)\b/.test(source);
  const declaresTheInset = /pt-page-safe|pt-safe|--safe-top/.test(source);
  return mountsATopBar || declaresTheInset;
};

/**
 * Screens that do NOT carry it yet, named rather than skipped.
 *
 * This is a defect list, not an exemption list. Every entry renders its first
 * element under the status bar on a notched device.
 *
 * rev 5 B3 scoped this as two screens (login, signup). It was ten. The eight
 * others were raised rather than absorbed, and the trade- and guest-facing four
 * — auth/confirm, reset-password, start, get-the-app — were fixed alongside.
 *
 * WHAT REMAINS IS THE FOUR CUSTOMER-FACING DOCUMENTS, held deliberately by
 * Jacob's decision of 9 Sep. Each is a live document a customer opens from a
 * link, and on each the control under the clock is the one they came to press —
 * accept the quote, sign the contract, pay the invoice. Moving four live
 * customer surfaces in a push with no device testing behind it is a different
 * risk from an auth screen, so they go through the §4 journey walk on a real
 * device instead.
 *
 * The list may only ever SHRINK. A new page that renders a bare <main> without
 * an inset fails immediately, which is the property this test exists for.
 */
const KNOWN_MISSING = [
  "c/[id]/page.tsx",
  "i/[id]/page.tsx",
  "i/[id]/paid/page.tsx",
  "q/[id]/page.tsx",
].sort();

describe("every screen carries the top safe-area inset", () => {
  const pages = pagesRenderingBareMain();

  it("finds the screens to check", () => {
    // Guards the walker itself: a refactor that moves pages elsewhere would
    // otherwise make this whole file pass by checking nothing.
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain("login/page.tsx");
    expect(pages).toContain("signup/page.tsx");
  });

  for (const page of pagesRenderingBareMain()) {
    if (KNOWN_MISSING.includes(page)) continue;
    it(`declares it or mounts a top bar: ${page}`, () => {
      expect(carriesTopInset(page)).toBe(true);
    });
  }

  it("the defect list only shrinks — no new screen may join it", () => {
    const actuallyMissing = pages.filter((page) => !carriesTopInset(page));
    expect(actuallyMissing).toEqual(KNOWN_MISSING);
  });

  it("never reaches for env() directly, which double-counts inside the shell", () => {
    const offenders = pages.filter((page) =>
      /env\(\s*safe-area-inset-top/.test(readFileSync(join(APP_DIR, page), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
