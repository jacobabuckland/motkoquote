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

  it("takes its height from the safe-area inset", () => {
    // The env() lives in the className as a Tailwind arbitrary value, which is
    // what makes it assertable: happy-dom's CSS parser does not recognise env()
    // and silently drops it from an inline style declaration.
    expect(backdrop().className).toContain("h-[env(safe-area-inset-top)]");
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
    const { AppHeader } = await import("@/components/ui/app-header");
    const { container } = render(
      <AppHeader companyName="Jacob's Electricians" onSignOut={async () => {}} />,
    );

    const row = container.querySelector("header")?.firstElementChild;
    expect(row?.className).toContain("pt-[max(0.75rem,env(safe-area-inset-top))]");
  });
});
