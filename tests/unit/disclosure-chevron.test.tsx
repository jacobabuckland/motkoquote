/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Disclosure } from "@/components/ui/disclosure";

afterEach(cleanup);

// A collapsed section used to be indistinguishable from a heading with nothing
// under it: the toggle worked, but nothing on screen said it was a toggle.
// These pin the affordance — one chevron, pointing sideways when shut and down
// when open — and pin that adding it left the accessible name alone.

const chevronOf = (container: HTMLElement) =>
  container.querySelector<SVGElement>(".disclosure-chevron");

describe("Disclosure chevron", () => {
  it("draws a chevron in the header", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={false}>
        <div>Content</div>
      </Disclosure>,
    );

    const chevron = chevronOf(container);
    expect(chevron).toBeTruthy();
    expect(screen.getByRole("button", { name: /Test Section/i }).contains(chevron!)).toBe(true);
  });

  it("points sideways when the section is shut", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={false}>
        <div>Content</div>
      </Disclosure>,
    );

    expect(chevronOf(container)!.style.transform).toBe("rotate(0deg)");
  });

  it("points down when the section is open", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={true}>
        <div>Content</div>
      </Disclosure>,
    );

    expect(chevronOf(container)!.style.transform).toBe("rotate(90deg)");
  });

  it("turns with the section as it is toggled", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={false}>
        <div>Content</div>
      </Disclosure>,
    );
    const header = screen.getByRole("button", { name: /Test Section/i });

    fireEvent.click(header);
    expect(chevronOf(container)!.style.transform).toBe("rotate(90deg)");

    fireEvent.click(header);
    expect(chevronOf(container)!.style.transform).toBe("rotate(0deg)");
  });

  it("is hidden from assistive tech — aria-expanded already carries the state", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={false}>
        <div>Content</div>
      </Disclosure>,
    );

    expect(chevronOf(container)!.getAttribute("aria-hidden")).toBe("true");
    // The name a screen reader announces is still just the title.
    expect(screen.getByRole("button", { name: "Test Section" })).toBeDefined();
  });

  it("animates on the motion tokens, so reduced motion settles it instantly", () => {
    const { container } = render(
      <Disclosure id="test" title="Test Section" defaultOpen={false}>
        <div>Content</div>
      </Disclosure>,
    );

    const style = chevronOf(container)!.style;
    expect(style.transitionDuration).toBe("var(--dur-base)");
    expect(style.transitionTimingFunction).toBe("var(--ease-standard)");
  });
});
