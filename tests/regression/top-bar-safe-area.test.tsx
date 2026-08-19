/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
// happy-dom does not resolve env(), so the assertion is on the declared
// padding rather than a computed pixel value — the point is that the inset is
// declared at all, and that the off-notch floor is still there via max().
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
    expect(padding).toContain("pt-[max(1rem,env(safe-area-inset-top))]");
    // A blanket `py-*` would silently overwrite the inset.
    expect(padding).not.toMatch(/(^|\s)py-/);
  });

  it("insets the signed-in app header the same way", () => {
    const { container } = render(
      <AppHeader companyName="Buckland Ltd" onSignOut={() => {}} />,
    );

    const padding = topInsetOf(container.querySelector("header") as HTMLElement);
    expect(padding).toContain("pt-[max(0.75rem,env(safe-area-inset-top))]");
    expect(padding).not.toMatch(/(^|\s)py-/);
  });
});
