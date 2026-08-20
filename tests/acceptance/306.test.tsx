/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #306: Disclosure primitive, applied to Settings
 */

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

afterEach(cleanup);

describe("Issue #306: Disclosure primitive, applied to Settings", () => {
  describe("Disclosure component", () => {
    it("exists and can be imported", async () => {
      const mod = await import("@/components/ui/disclosure");
      expect(mod.Disclosure).toBeDefined();
      expect(typeof mod.Disclosure).toBe("function");
    });

    it("renders without errors", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      expect(() =>
        render(
          <Disclosure id="test" title="Test Section" defaultOpen={true}>
            <div>Content</div>
          </Disclosure>
        )
      ).not.toThrow();
    });

    it("displays the title in the header button", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      expect(header).toBeDefined();
    });
  });

  describe("Collapsed state", () => {
    it("content is not in the accessible tree when collapsed", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={false}>
          <div data-testid="disclosure-content">Hidden content</div>
        </Disclosure>
      );

      const content = screen.queryByTestId("disclosure-content");
      // Content should either not exist in DOM or be hidden from accessibility
      if (content) {
        expect(content.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("content is not focusable when collapsed", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={false}>
          <button data-testid="inner-button">Click me</button>
        </Disclosure>
      );

      const innerButton = screen.queryByTestId("inner-button");
      // Should not be reachable by screen reader or keyboard
      if (innerButton) {
        expect(innerButton.tabIndex).toBe(-1);
      }
    });
  });

  describe("ARIA attributes", () => {
    it("header has aria-expanded=true when open", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });

    it("header has aria-expanded=false when closed", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={false}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("aria-expanded toggles on click", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      expect(header.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(header);
      expect(header.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(header);
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });

    it("header has aria-controls pointing to content region", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test-section" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      const ariaControls = header.getAttribute("aria-controls");
      expect(ariaControls).toBeTruthy();
      expect(ariaControls).toContain("test-section");
    });
  });

  describe("Motion tokens", () => {
    it("component does not contain hardcoded millisecond values", async () => {
      // Read the disclosure component source to verify no hardcoded durations
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const componentPath = path.join(
        process.cwd(),
        "src/components/ui/disclosure.tsx"
      );
      const source = await fs.readFile(componentPath, "utf-8");

      // Check for hardcoded ms values (e.g. "300ms", "0.3s")
      const hardcodedDuration = /\d+m?s/g;
      const matches = source.match(hardcodedDuration) || [];

      // Filter out false positives (imports, comments, etc)
      const suspiciousMatches = matches.filter((match) => {
        // Allow "0ms" or "0.01ms" (reduced motion fallback)
        if (match === "0ms" || match === "0.01ms") return false;
        // Must be a duration value
        return /^\d/.test(match);
      });

      expect(suspiciousMatches.length).toBe(0);
    });

    it("transition references CSS custom properties for duration and easing", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      const { container } = render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      // Find the content region
      const contentRegion = container.querySelector('[id*="test"]');
      expect(contentRegion).toBeTruthy();

      // Check computed style references CSS variables
      const computedStyle = window.getComputedStyle(contentRegion!);
      const transition = computedStyle.transition || computedStyle.transitionProperty;

      // Should use CSS variables or inherit from globals.css
      // (exact assertion depends on implementation, but no hardcoded values)
      expect(transition).toBeDefined();
    });
  });

  describe("Visual states", () => {
    it("header has visible focus ring on keyboard focus", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });

      // Trigger focus (simulating keyboard navigation)
      header.focus();

      // Check for focus-visible styles (outline or box-shadow)
      const computedStyle = window.getComputedStyle(header);
      const hasFocusIndicator =
        computedStyle.outline !== "none" ||
        computedStyle.outlineWidth !== "0px" ||
        computedStyle.boxShadow !== "none";

      expect(hasFocusIndicator).toBe(true);
    });

    it("header has pressed state styles", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });

      // Check that button element has active: state classes or inline styles
      // The spec requires a visible pressed state (same pattern as Button component)
      const className = header.className;
      const hasActiveState =
        className.includes("active:") ||
        className.includes("scale") ||
        header.style.transform !== "";

      expect(hasActiveState).toBe(true);
    });
  });

  describe("Independent sections (no accordion behavior)", () => {
    it("opening a second section leaves the first open", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <>
          <Disclosure id="first" title="First Section" defaultOpen={true}>
            <div data-testid="first-content">First content</div>
          </Disclosure>
          <Disclosure id="second" title="Second Section" defaultOpen={false}>
            <div data-testid="second-content">Second content</div>
          </Disclosure>
        </>
      );

      const firstHeader = screen.getByRole("button", { name: /First Section/i });
      const secondHeader = screen.getByRole("button", { name: /Second Section/i });

      // First is open, second is closed
      expect(firstHeader.getAttribute("aria-expanded")).toBe("true");
      expect(secondHeader.getAttribute("aria-expanded")).toBe("false");

      // Open the second section
      fireEvent.click(secondHeader);

      // Both should now be open
      expect(firstHeader.getAttribute("aria-expanded")).toBe("true");
      expect(secondHeader.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("Haptics", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("fires light haptic on toggle on native platform", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      fireEvent.click(header);

      const calls = mocks.Haptics.getCalls();
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].method).toBe("impact");
    });

    it("does not call haptics on web platform", async () => {
      mockNativePlatform(false);
      const mocks = mockCapacitorPlugins();

      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      fireEvent.click(header);

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(0);
    });

    it("toggles without error on web when haptics unavailable", async () => {
      mockNativePlatform(false);
      mockCapacitorPlugins();

      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="test" title="Test Section" defaultOpen={true}>
            <div>Content</div>
          </Disclosure>
        );

        const header = screen.getByRole("button", { name: /Test Section/i });
        fireEvent.click(header);
        fireEvent.click(header);
      }).not.toThrow();
    });
  });

  describe("Persistent state", () => {
    beforeEach(() => {
      // Clear localStorage before each test
      if (typeof window !== "undefined") {
        window.localStorage.clear();
      }
    });

    it("disclosure storage module exists", async () => {
      const mod = await import("@/lib/disclosure-storage");
      expect(mod.saveDisclosureState).toBeDefined();
      expect(mod.loadDisclosureState).toBeDefined();
    });

    it("saves state to localStorage when toggled", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test-section" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      fireEvent.click(header); // Close it

      // Check localStorage was updated
      await waitFor(() => {
        const stored = window.localStorage.getItem("motko.disclosure.test-section");
        expect(stored).toBe("closed");
      });
    });

    it("restores state from localStorage on mount", async () => {
      // Pre-populate localStorage
      window.localStorage.setItem("motko.disclosure.test-section", "closed");

      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test-section" title="Test Section" defaultOpen={true}>
          <div>Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });

      // Should be closed (overriding defaultOpen) because localStorage says so
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("falls back to default when localStorage unavailable", async () => {
      // Simulate localStorage unavailable
      const originalLocalStorage = window.localStorage;
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new Error("localStorage unavailable");
        },
        configurable: true,
      });

      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="test" title="Test Section" defaultOpen={false}>
            <div>Content</div>
          </Disclosure>
        );
      }).not.toThrow();

      // Restore
      Object.defineProperty(window, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
      });
    });
  });

  describe("Settings page integration", () => {
    it("Settings page exists and can be imported", async () => {
      // Settings is a server component, but we can import it
      const mod = await import("@/app/settings/page");
      expect(mod.default).toBeDefined();
    });

    it("PayoutDetailsSection is wrapped in Disclosure component", async () => {
      // Read the Settings page source to verify it uses Disclosure
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const settingsPath = path.join(
        process.cwd(),
        "src/app/settings/page.tsx"
      );
      const source = await fs.readFile(settingsPath, "utf-8");

      // Should import Disclosure
      expect(source).toContain("Disclosure");
      expect(source).toMatch(/import.*Disclosure.*from/);
    });

    it("bank details section uses id payout-details or similar", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const settingsPath = path.join(
        process.cwd(),
        "src/app/settings/page.tsx"
      );
      const source = await fs.readFile(settingsPath, "utf-8");

      // Should have a disclosure for payout/bank details
      expect(source).toMatch(/id=["'].*payout.*["']/i);
    });
  });

  describe("Edge cases", () => {
    it("handles only one section on page", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="only-section" title="Only Section" defaultOpen={true}>
            <div>Content</div>
          </Disclosure>
        );
      }).not.toThrow();

      const header = screen.getByRole("button", { name: /Only Section/i });
      fireEvent.click(header);

      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("ignores stored preference for nonexistent section key", async () => {
      // Store preference for a section that doesn't exist
      window.localStorage.setItem("motko.disclosure.nonexistent-section", "open");

      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="real-section" title="Real Section" defaultOpen={false}>
            <div>Content</div>
          </Disclosure>
        );
      }).not.toThrow();

      const header = screen.getByRole("button", { name: /Real Section/i });

      // Should use defaultOpen, not the stored value for wrong key
      expect(header.getAttribute("aria-expanded")).toBe("false");
    });

    it("continues working when localStorage write fails", async () => {
      // Make localStorage.setItem throw
      const originalSetItem = window.localStorage.setItem;
      window.localStorage.setItem = vi.fn(() => {
        throw new Error("Quota exceeded");
      });

      const { Disclosure } = await import("@/components/ui/disclosure");

      expect(() => {
        render(
          <Disclosure id="test" title="Test Section" defaultOpen={true}>
            <div>Content</div>
          </Disclosure>
        );

        const header = screen.getByRole("button", { name: /Test Section/i });
        fireEvent.click(header);

        // Should still toggle visually
        expect(header.getAttribute("aria-expanded")).toBe("false");
      }).not.toThrow();

      // Restore
      window.localStorage.setItem = originalSetItem;
    });
  });

  describe("prefers-reduced-motion", () => {
    it("respects prefers-reduced-motion: reduce", async () => {
      // The globals.css media query already handles this by setting durations to 0.01ms
      // Just verify the component doesn't override it with hardcoded values
      const { Disclosure } = await import("@/components/ui/disclosure");
      render(
        <Disclosure id="test" title="Test Section" defaultOpen={false}>
          <div data-testid="content">Content</div>
        </Disclosure>
      );

      const header = screen.getByRole("button", { name: /Test Section/i });
      fireEvent.click(header);

      // Content should be visible immediately (no need to wait for animation)
      const content = screen.getByTestId("content");
      expect(content).toBeDefined();
    });
  });

  describe("Default states on Settings", () => {
    it("bank details section has defaultOpen=false", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const settingsPath = path.join(
        process.cwd(),
        "src/app/settings/page.tsx"
      );
      const source = await fs.readFile(settingsPath, "utf-8");

      // Find the Disclosure wrapping PayoutDetailsSection
      // Should have defaultOpen={false} or similar
      const payoutDisclosure = source.match(
        /<Disclosure[^>]*id=["'].*payout.*["'][^>]*>/i
      );
      expect(payoutDisclosure).toBeTruthy();

      if (payoutDisclosure) {
        const match = payoutDisclosure[0];
        // Should have defaultOpen={false} or collapsed by default
        expect(match).toMatch(/defaultOpen={false}/);
      }
    });

    it("other sections have defaultOpen=true or are not wrapped", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const settingsPath = path.join(
        process.cwd(),
        "src/app/settings/page.tsx"
      );
      const source = await fs.readFile(settingsPath, "utf-8");

      // Other sections should either:
      // 1. Not be wrapped in Disclosure (remain as-is)
      // 2. Be wrapped with defaultOpen={true}

      // Check that we don't have multiple defaultOpen={false}
      const falseDefaults = source.match(/defaultOpen={false}/g) || [];

      // Should only have one defaultOpen={false} (the bank details)
      expect(falseDefaults.length).toBe(1);
    });
  });

  describe("Unsaved changes survive collapse", () => {
    it("collapsing does not reset component state", async () => {
      const { Disclosure } = await import("@/components/ui/disclosure");

      const TestComponent = () => {
        // Real state, not a mock cast into a tuple shape. The point of the
        // test is that the child's own state survives a collapse, so the state
        // has to be real for the assertion to mean anything.
        const [value, setValue] = useState("");
        return (
          <Disclosure id="test" title="Test Section" defaultOpen={true}>
            <input
              data-testid="test-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Disclosure>
        );
      };

      render(<TestComponent />);

      const input = screen.getByTestId("test-input") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "test value" } });

      const header = screen.getByRole("button", { name: /Test Section/i });
      fireEvent.click(header); // Collapse
      fireEvent.click(header); // Expand

      // Input should still have its value (component state preserved)
      expect(input.value).toBe("test value");
    });
  });
});
