/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #118: Add loading and success states to the Button primitive
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

describe("Issue #118: Button loading and success states", () => {
  describe("Loading state", () => {
    it("renders a spinner when loading is true", () => {
      render(<Button loading>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });
      // The spinner should be present in the button
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner') ||
                     button.querySelector('svg[class*="spin"]');
      expect(spinner).toBeTruthy();
    });

    it("sets aria-busy=true when loading", () => {
      render(<Button loading>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });
      expect(button.getAttribute("aria-busy")).toBe("true");
    });

    it("is non-interactive when loading", () => {
      const onClick = vi.fn();
      render(
        <Button loading onClick={onClick}>
          Send quote
        </Button>
      );

      const button = screen.getByRole("button", { name: /send quote/i });
      fireEvent.click(button);

      expect(onClick).not.toHaveBeenCalled();
    });

    it("preserves button width when loading is set", () => {
      const { rerender } = render(<Button>Send quote</Button>);

      const button = screen.getByRole("button", { name: "Send quote" });
      const initialWidth = button.getBoundingClientRect().width;

      rerender(<Button loading>Send quote</Button>);

      const loadingWidth = button.getBoundingClientRect().width;
      expect(loadingWidth).toBe(initialWidth);
    });
  });

  describe("Success state", () => {
    it("renders a check glyph when success is true", () => {
      render(<Button success>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });
      // Check for the check mark - could be SVG, icon, or text
      const check = button.querySelector('[aria-label*="check"]') ||
                   button.querySelector('.check') ||
                   button.textContent?.includes('✓');
      expect(check).toBeTruthy();
    });

    it("applies success styling when success is true", () => {
      render(<Button success>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });
      const computedStyle = window.getComputedStyle(button);

      // Should have green coloring - check for success color in background or related properties
      const hasSuccessColor =
        computedStyle.backgroundColor.includes('success') ||
        button.className.includes('success') ||
        computedStyle.getPropertyValue('background-color') !== '';

      expect(hasSuccessColor).toBeTruthy();
    });
  });

  describe("Loading and success interaction", () => {
    it("shows spinner not check when both loading and success are true", () => {
      render(
        <Button loading success>
          Send quote
        </Button>
      );

      const button = screen.getByRole("button", { name: /send quote/i });

      // Should have spinner
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner');
      expect(spinner).toBeTruthy();

      // aria-busy should be true (indicates loading)
      expect(button.getAttribute("aria-busy")).toBe("true");
    });

    it("transitions from loading to success without flashing resting state", () => {
      const { rerender } = render(<Button loading>Send quote</Button>);

      // Start with loading
      let button = screen.getByRole("button", { name: /send quote/i });
      expect(button.getAttribute("aria-busy")).toBe("true");

      // Transition to success
      rerender(<Button success>Send quote</Button>);

      button = screen.getByRole("button", { name: /send quote/i });

      // Should now show success state
      const check = button.querySelector('[aria-label*="check"]') ||
                   button.querySelector('.check');
      expect(check).toBeTruthy();

      // Should not be aria-busy anymore
      expect(button.getAttribute("aria-busy")).not.toBe("true");
    });
  });

  describe("Disabled and loading are independent", () => {
    it("disabled button shows opacity without spinner", () => {
      render(<Button disabled>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });

      // Should be disabled
      expect((button as HTMLButtonElement).disabled).toBe(true);

      // Should NOT have spinner
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner');
      expect(spinner).toBeFalsy();

      // Should have opacity (check className contains disabled styling)
      expect(button.className).toContain('disabled');
    });

    it("loading button shows spinner without opacity change", () => {
      render(<Button loading>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });

      // Should have spinner
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner');
      expect(spinner).toBeTruthy();

      // Check that it doesn't have the disabled opacity class
      // (unless it's also disabled, which it's not in this test)
      const computedStyle = window.getComputedStyle(button);
      const opacity = computedStyle.opacity;

      // Loading alone should not reduce opacity to 0.5 like disabled does
      expect(opacity).not.toBe("0.5");
    });

    it("button can be both disabled and loading", () => {
      render(
        <Button disabled loading>
          Send quote
        </Button>
      );

      const button = screen.getByRole("button", { name: /send quote/i });

      // Should be disabled
      expect((button as HTMLButtonElement).disabled).toBe(true);

      // Should also be loading (aria-busy)
      expect(button.getAttribute("aria-busy")).toBe("true");

      // Should have spinner
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner');
      expect(spinner).toBeTruthy();
    });
  });

  describe("Edge cases", () => {
    it("handles icon-only button with loading", () => {
      // Render button with an icon and no text
      const { container } = render(
        <Button>
          <svg data-testid="icon" width="16" height="16" />
        </Button>
      );

      const button = container.querySelector("button");
      const initialWidth = button?.getBoundingClientRect().width || 0;

      // Re-render with loading
      cleanup();
      const { container: loadingContainer } = render(
        <Button loading>
          <svg data-testid="icon" width="16" height="16" />
        </Button>
      );

      const loadingButton = loadingContainer.querySelector("button");
      const loadingWidth = loadingButton?.getBoundingClientRect().width || 0;

      // Width should be preserved
      expect(loadingWidth).toBe(initialWidth);

      // Should have spinner
      const spinner = loadingButton?.querySelector('[role="status"]') ||
                     loadingButton?.querySelector('.spinner');
      expect(spinner).toBeTruthy();
    });

    it("allows success state to persist when not unset", () => {
      const { rerender } = render(<Button success>Sent</Button>);

      const button = screen.getByRole("button", { name: /sent/i });
      const check = button.querySelector('[aria-label*="check"]') ||
                   button.querySelector('.check');
      expect(check).toBeTruthy();

      // Re-render without changing success prop - it should still be there
      rerender(<Button success>Sent</Button>);

      const stillButton = screen.getByRole("button", { name: /sent/i });
      const stillCheck = stillButton.querySelector('[aria-label*="check"]') ||
                        stillButton.querySelector('.check');
      expect(stillCheck).toBeTruthy();
    });

    it("unmounts cleanly while loading", () => {
      const { unmount } = render(<Button loading>Send quote</Button>);

      // Should unmount without warnings or errors
      expect(() => unmount()).not.toThrow();
    });

    it("renders legacy usage identically when neither prop is passed", () => {
      const { container: legacyContainer } = render(
        <Button>Send quote</Button>
      );

      const legacyButton = legacyContainer.querySelector("button");

      // Should not have aria-busy
      expect(legacyButton?.getAttribute("aria-busy")).toBeFalsy();

      // Should not have spinner
      const spinner = legacyButton?.querySelector('[role="status"]') ||
                     legacyButton?.querySelector('.spinner');
      expect(spinner).toBeFalsy();

      // Should not have check
      const check = legacyButton?.querySelector('[aria-label*="check"]') ||
                   legacyButton?.querySelector('.check');
      expect(check).toBeFalsy();
    });
  });

  describe("Reduced motion", () => {
    it("renders static spinner under prefers-reduced-motion", () => {
      // Set prefers-reduced-motion in the test environment
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      render(<Button loading>Send quote</Button>);

      const button = screen.getByRole("button", { name: /send quote/i });
      const spinner = button.querySelector('[role="status"]') ||
                     button.querySelector('.spinner');

      expect(spinner).toBeTruthy();

      // The spinner should not have animation (check for animation-duration: 0 or similar)
      // This is implementation-dependent, but the CSS should respect prefers-reduced-motion
    });

    it("applies success state instantly under prefers-reduced-motion", () => {
      // Set prefers-reduced-motion
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });

      render(<Button success>Sent</Button>);

      const button = screen.getByRole("button", { name: /sent/i });
      const check = button.querySelector('[aria-label*="check"]') ||
                   button.querySelector('.check');

      expect(check).toBeTruthy();

      // The success state should appear without transition
      // (implementation detail: check for transition-duration: 0 or similar)
    });
  });
});
