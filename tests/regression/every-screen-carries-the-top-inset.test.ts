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
 *   • declare it directly — `pt-page-safe`, `pt-bar-safe`, `pt-safe`, or
 *     `var(--safe-top)`.
 *
 * ALWAYS THE TOKEN, NEVER env(). The reasoning is written out at the token in
 * globals.css and is not repeated here — but note that this paragraph used to
 * say `--safe-top` is 0px inside the Capacitor shell because
 * `ios.contentInset: "always"` had already inset the web view. THAT IS NO
 * LONGER TRUE and describing a build that never shipped is how this exact
 * mechanism got "fixed" twice on a confident, wrong premise. Since 9 Sep 2026
 * capacitor.config.ts is `contentInset: "never"`, the `.native-app` override
 * that zeroed the token is gone, and `--safe-top` is env(safe-area-inset-top)
 * everywhere. It stays the thing to reach for because it is the ONE place that
 * decision lives, not because it resolves differently per platform.
 *
 * WHY THIS TEST READS SOURCE. These are server components spanning data
 * fetching and auth redirects; rendering them all to inspect a padding value is
 * not available here, and happy-dom resolves neither env() nor custom
 * properties, so a computed pixel assertion would prove nothing either. The
 * property worth pinning is that the inset is DECLARED at all — which is a fact
 * about the file. tests/regression/top-bar-safe-area.test.tsx reads source for
 * the same reason and set the precedent.
 *
 * ── TRANSIENT ROOTS ──────────────────────────────────────────────────────
 *
 * `loading.tsx`, `error.tsx` and `not-found.tsx` are screen roots too, and for
 * a long time nothing checked them: this walker only visited `page.tsx`. All
 * 31 of them shipped with no inset. That is not a lesser version of the page
 * defect, it is a worse one — `dashboard/loading.tsx` renders a stand-in top
 * bar on EVERY navigation to the dashboard, so the collision is the first
 * frame of every journey rather than a one-off on a screen you rarely see.
 *
 * WHAT COUNTS AS LAYING OUT FROM THE TOP. A root is checked when it renders a
 * `<main>` or a `<header>` of its own — those start at the top edge and grow
 * down, so there is a top edge to protect. A root that is a centred overlay
 * (`fixed inset-0 … justify-center`, or a centred spinner) has no top edge:
 * its content is pinned to the middle of the viewport and cannot reach the
 * clock however tall the notch is. Those are exempt by construction, not by
 * listing, which is why no allowlist is needed for them.
 *
 * A root that renders NEITHER — `c/error.tsx` returning `<CustomerLinkError>`
 * and nothing else — is not a screen root at all; the component it delegates
 * to is. Those components are checked directly below, so the six delegating
 * route files are covered without being walked.
 */

const APP_DIR = resolve(__dirname, "../../src/app");
const SRC_DIR = resolve(__dirname, "../../src");

const TRANSIENT = ["loading.tsx", "error.tsx", "not-found.tsx"];

const walkFor = (match: (entry: string) => boolean): string[] => {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (match(entry)) found.push(relative(APP_DIR, full));
    }
  };
  walk(APP_DIR);
  return found.sort();
};

const pagesRenderingBareMain = (): string[] =>
  walkFor((entry) => entry === "page.tsx").filter((rel) =>
    readFileSync(join(APP_DIR, rel), "utf8").includes("<main"),
  );

/**
 * Transient roots that lay out from the top — see the header note. A root
 * rendering neither `<main>` nor `<header>` is a centred overlay or a pure
 * delegator, and has no top edge of its own to protect.
 */
const transientRootsLayingOutFromTheTop = (): string[] =>
  walkFor((entry) => TRANSIENT.includes(entry)).filter((rel) => {
    const source = readFileSync(join(APP_DIR, rel), "utf8");
    return /<main[\s>]/.test(source) || /<header[\s>]/.test(source);
  });

const carriesTopInset = (relPath: string, base = APP_DIR): boolean => {
  const source = readFileSync(join(base, relPath), "utf8");
  const mountsATopBar = /\b(AppHeader|PageHeader)\b/.test(source);
  const declaresTheInset = /pt-page-safe|pt-bar-safe|pt-safe|--safe-top/.test(source);
  return mountsATopBar || declaresTheInset;
};

/**
 * The screen components the six delegating route files under /q, /c and /i
 * return. They are the real roots for those routes.
 */
const DELEGATED_SCREENS = [
  "components/customer/link-error.tsx",
  "components/customer/link-not-found.tsx",
];

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

/**
 * The transient half of the same defect list, and held for the same reason —
 * these are the loading skeletons OF the four deferred documents above.
 *
 * Inseting a skeleton whose page is not inset reintroduces the exact layout
 * jump the skeleton exists to prevent: the stand-in would sit 62px lower than
 * the content that replaces it. A skeleton is only ever as correct as the page
 * it stands in for, so these three move WITH their pages in the device walk,
 * not before them.
 *
 * Same contract: the list may only ever SHRINK, and it empties in the same
 * change that empties KNOWN_MISSING.
 */
const KNOWN_MISSING_TRANSIENT = [
  "c/[id]/loading.tsx",
  "i/[id]/loading.tsx",
  "q/[id]/loading.tsx",
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

  describe("transient roots — loading, error and not-found", () => {
    const transient = transientRootsLayingOutFromTheTop();

    it("finds the transient roots to check", () => {
      // Same guard as above. These were invisible to this walker until 11 Sep
      // 2026 and all 31 of them shipped without an inset, so a silent zero here
      // is the failure mode worth pinning.
      expect(transient.length).toBeGreaterThan(15);
      expect(transient).toContain("dashboard/loading.tsx");
      expect(transient).toContain("jobs/[id]/loading.tsx");
    });

    for (const root of transientRootsLayingOutFromTheTop()) {
      if (KNOWN_MISSING_TRANSIENT.includes(root)) continue;
      it(`declares it or mounts a top bar: ${root}`, () => {
        expect(carriesTopInset(root)).toBe(true);
      });
    }

    it("the transient defect list only shrinks — no new root may join it", () => {
      const actuallyMissing = transient.filter((root) => !carriesTopInset(root));
      expect(actuallyMissing).toEqual(KNOWN_MISSING_TRANSIENT);
    });

    it("never reaches for env() directly either", () => {
      const offenders = transient.filter((root) =>
        /env\(\s*safe-area-inset-top/.test(readFileSync(join(APP_DIR, root), "utf8")),
      );
      expect(offenders).toEqual([]);
    });
  });

  describe("screens reached by delegation", () => {
    for (const screen of DELEGATED_SCREENS) {
      it(`carries the inset: ${screen}`, () => {
        expect(carriesTopInset(screen, SRC_DIR)).toBe(true);
      });
    }

    it("the delegating route files still delegate to them", () => {
      // If a route file stops delegating and grows its own <main>, the walker
      // above starts checking it directly — but only if this stays true. A
      // route that renders its own markup AND imports the component would be
      // covered twice; one that inlines the markup without importing would be
      // caught by the transient walker. This pins the shape either way.
      const delegators = walkFor((entry) => TRANSIENT.includes(entry)).filter((rel) =>
        /CustomerLink(Error|NotFound)/.test(readFileSync(join(APP_DIR, rel), "utf8")),
      );
      expect(delegators).toEqual([
        "c/error.tsx",
        "c/not-found.tsx",
        "i/error.tsx",
        "i/not-found.tsx",
        "q/error.tsx",
        "q/not-found.tsx",
      ]);
    });
  });
});
