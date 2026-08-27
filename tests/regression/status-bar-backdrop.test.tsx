/**
 * @vitest-environment happy-dom
 */

// Regression: Settings content scrolled under the iOS status bar with nothing
// behind it — "Taken from payments" rendered behind the clock, and on the next
// screenshot the contractor's fee figures rendered behind "22:49".
//
// The top bars were never the problem. AppHeader and PageHeader both carry
// pt-[max(…,env(safe-area-inset-top))], bound by top-bar-safe-area.test.tsx.
// But AppHeader is `border-b bg-ground` — not sticky, not fixed — so once a
// long page scrolls it leaves, and body content passes under the status bar
// with no backdrop behind it.
//
// The voice screen looked correct only incidentally: it lays out flex-1 with an
// inner max-h-56 scroll region, so the page itself never scrolls and cannot
// exercise the defect. It was not doing something Settings was missing — which
// is why the fix is one global element rather than per-screen padding.
//
// As with the existing safe-area test, happy-dom does not resolve env(), so
// these assert the declared value rather than a computed pixel height. Final
// confirmation is one scroll on a notched device.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBarBackdrop } from "@/components/ui/status-bar-backdrop";

afterEach(cleanup);

describe("the status-bar strip has an opaque backdrop", () => {
  const backdrop = () => {
    render(<StatusBarBackdrop />);
    return screen.getByTestId("status-bar-backdrop");
  };

  it("takes its height from --safe-top, the same token the top bars use", () => {
    // The expression lives in the className as a Tailwind arbitrary value,
    // which is what makes it assertable: happy-dom's CSS parser does not
    // recognise env() and silently drops it from an inline style declaration.
    //
    // --safe-top rather than env(safe-area-inset-top) since 26 Aug 2026. Read
    // directly, env() reports the full notch inside a web view the Capacitor
    // shell has ALREADY inset, so this painted 62px of opaque bg-ground over
    // the top bars once their own padding correctly collapsed to zero there —
    // taking the company-name home link and the "← Back" link with it.
    expect(backdrop().className).toContain("h-[var(--safe-top)]");
  });

  it("collapses to nothing off-notch rather than flooring", () => {
    // A max() floor would paint a stray bar across the top of every desktop
    // browser, where the inset is 0. The padding utilities carry a floor for
    // their own reasons; this must not.
    expect(
      backdrop().className,
      "the backdrop must collapse to zero off-notch — a floor would render a bar on the web",
    ).not.toContain("max(");
  });

  it("is fixed to the top, so it does not scroll away like the header does", () => {
    const el = backdrop();
    expect(el.className).toContain("fixed");
    expect(el.className).toContain("top-0");
    expect(el.className).toContain("inset-x-0");
  });

  it("is opaque, or there is nothing behind the content", () => {
    expect(backdrop().className).toContain("bg-ground");
  });

  it("is inert, so it cannot swallow taps in the top strip of every screen", () => {
    expect(backdrop().className).toContain("pointer-events-none");
  });

  it("is hidden from assistive tech, being pure decoration", () => {
    expect(backdrop().getAttribute("aria-hidden")).toBe("true");
  });

  it("sits below the toast and offline-banner layer at z-50", () => {
    // Both overlays sit at z-50 and both carry their own top inset, so the
    // backdrop must never cover them.
    const el = backdrop();
    expect(el.className).toContain("z-40");
    expect(el.className).not.toContain("z-50");
  });
});

describe("the backdrop is additional, not a replacement", () => {
  it("leaves the top bars carrying their own inset", async () => {
    // An unscrolled header must still sit below the notch under its own
    // padding — the backdrop only covers the strip behind it.
    //
    // The header's inset is --safe-top rather than env() directly, since
    // 26 Aug 2026: inside the Capacitor shell the web view is ALREADY inset
    // (ios.contentInset "always") while env() still reports the full notch
    // (viewportFit "cover"), so both were applying and the bars sat one whole
    // inset too low. --safe-top is env(safe-area-inset-top) on the web and 0
    // in the shell.
    //
    // The backdrop reads the SAME token. It diverged for one day, on the
    // premise that "a content inset is a scroll inset, so page content still
    // travels up through it and can reach the clock" — which conflates the top
    // of the web view with the top of the screen. The shell's native container
    // owns the strip above the web view, so nothing web-side can reach the
    // clock there, and the divergence only served to paint over this header.
    // Both now collapse together in the shell and both are full height on the
    // web. Bound in tests/regression/top-bar-safe-area.test.tsx.
    const { AppHeader } = await import("@/components/ui/app-header");
    const { container } = render(
      <AppHeader companyName="Jacob's Electricians" onSignOut={async () => {}} />,
    );

    const row = container.querySelector("header")?.firstElementChild;
    expect(row?.className).toContain("pt-[max(0.75rem,var(--safe-top))]");
    // Still an inset, still with the off-notch floor. A blanket py-* here
    // would silently overwrite it, which is the original defect.
    expect(row?.className).not.toMatch(/(^|\s)py-/);
  });
});
