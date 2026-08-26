/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PageHeader } from "@/components/ui/page-header";
import { AppHeader } from "@/components/ui/app-header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/jobs",
}));

afterEach(cleanup);

// The root layout sets `viewportFit: "cover"`, so the document starts at the
// very top of the screen on a notched iPhone. A top bar with only its own
// padding therefore renders UNDER the status bar: on an iPhone 17 the guest
// screen's "Sign in" link sat behind the battery indicator and could not be
// tapped. Each top bar has to carry the safe-area inset itself.
//
// happy-dom does not resolve env() or custom properties, so the assertion is on
// the declared padding rather than a computed pixel value — the point is that
// the inset is declared at all, and that the off-notch floor is still there via
// max().
//
// The declaration moved from env(safe-area-inset-top) to var(--safe-top) on
// 26 Aug 2026, because both insets were being applied inside the Capacitor
// shell. ios.contentInset: "always" insets the web view, and viewportFit
// "cover" means env() still reports the full notch inside it — so the bars sat
// one whole inset too low. Measured doubled to the pixel on an iPhone 16 Pro:
// the native #004225 container visible for 62 CSS px, then 62 CSS px of header
// padding below it.
//
// --safe-top resolves to env(safe-area-inset-top) on the web and 0 inside the
// shell (globals.css). So these assertions still cover the original defect —
// the inset must be DECLARED, or the guest "Sign in" link goes back under the
// battery indicator — while the shell no longer double-counts it.
const topInsetOf = (bar: HTMLElement) => {
  const row = bar.firstElementChild as HTMLElement | null;
  return row?.className ?? "";
};

describe("top bars on a notched device", () => {
  it("keeps the guest Sign in link out from under the status bar", () => {
    const { container } = render(
      <PageHeader
        title="Your quote"
        action={<a href="/login">Sign in</a>}
      />,
    );

    // The link is the thing that was unreachable — it must still be there…
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();

    // …and the bar it sits in must be pushed below the notch.
    const padding = topInsetOf(container.querySelector("header") as HTMLElement);
    expect(padding).toContain("pt-[max(1rem,var(--safe-top))]");
    // A blanket `py-*` would silently overwrite the inset.
    expect(padding).not.toMatch(/(^|\s)py-/);
  });

  it("insets the signed-in app header the same way", () => {
    const { container } = render(
      <AppHeader companyName="Buckland Ltd" onSignOut={() => {}} />,
    );

    const padding = topInsetOf(container.querySelector("header") as HTMLElement);
    expect(padding).toContain("pt-[max(0.75rem,var(--safe-top))]");
    expect(padding).not.toMatch(/(^|\s)py-/);
  });
});

describe("the token behind the inset", () => {
  // The bars are only as correct as what --safe-top resolves to, and that
  // lives in CSS rather than in any component — so it is asserted here, next
  // to the components that depend on it.
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf-8");

  it("is the real notch inset by default, for the web", () => {
    // Without this the original defect returns: a cover-fit viewport puts the
    // bar under the iOS status bar and its contents cannot be tapped.
    expect(css).toMatch(/--safe-top:\s*env\(safe-area-inset-top\)/);
  });

  it("is zero inside the Capacitor shell, which has already inset the web view", () => {
    expect(css).toMatch(/\.native-app\s*\{[^}]*--safe-top:\s*0px/);
  });

  it("leaves StatusBarBackdrop reading env() directly", () => {
    // Deliberate, and not an oversight to tidy up. A content inset is a SCROLL
    // inset, so page content still scrolls up through it and can reach the
    // clock — the backdrop is what stops a contractor's fee figures rendering
    // behind "22:49". Switching it to --safe-top would zero it in the app and
    // reintroduce exactly that.
    const backdrop = readFileSync(
      resolve(process.cwd(), "src/components/ui/status-bar-backdrop.tsx"),
      "utf-8",
    );
    expect(backdrop).toContain("h-[env(safe-area-inset-top)]");
  });
});
