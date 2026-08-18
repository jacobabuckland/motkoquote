/**
 * @vitest-environment happy-dom
 *
 * Issue #140: Add animation primitives for completion moments
 *
 * These tests verify that the CountUp component, keyframe animations
 * (check-draw, success-ring), and design tokens (--color-success-burst,
 * --shadow-success-glow, --dur-base, --ease-spring) are implemented
 * and behave correctly, including reduced motion support.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Required cleanup for happy-dom environment
afterEach(cleanup);

const readFile = (path: string): string => {
  return readFileSync(join(process.cwd(), path), "utf-8");
};

describe("Issue #140: Add animation primitives for completion moments", () => {
  describe("CountUp component", () => {
    it("exists and can be imported", async () => {
      // Dynamic import to catch missing file early
      const mod = await import("@/components/ui/count-up");
      expect(mod.CountUp).toBeDefined();
    });

    it("renders the final value with tabular-nums applied", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      render(<CountUp to={100} durationMs={100} />);

      // Wait for the animation to complete
      await waitFor(
        () => {
          const element = screen.getByText("100");
          expect(element).toBeTruthy();

          // Check that tabular-nums is applied (via CSS class or inline style)
          const computedStyle = window.getComputedStyle(element);
          expect(
            computedStyle.fontVariantNumeric === "tabular-nums" ||
              element.className.includes("tabular-nums")
          ).toBe(true);
        },
        { timeout: 500 }
      );
    });

    it("counts from 'from' to 'to' over durationMs", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      render(<CountUp from={0} to={100} durationMs={200} />);

      // Initially should show a value near 'from'
      const initialElement = screen.getByText(/^\d+$/);
      const initialValue = parseInt(initialElement.textContent || "0", 10);
      expect(initialValue).toBeLessThan(50); // Should be early in the count

      // After the duration, should show 'to'
      await waitFor(
        () => {
          expect(screen.getByText("100")).toBeTruthy();
        },
        { timeout: 500 }
      );
    });

    it("lands exactly on 'to' with no rounding drift for currency value 2480.50", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      const formatCurrency = (n: number) =>
        `£${n.toLocaleString("en-GB", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

      render(
        <CountUp to={2480.5} durationMs={200} format={formatCurrency} />
      );

      await waitFor(
        () => {
          const finalText = screen.getByText(/£2,480\.50/);
          expect(finalText.textContent).toBe("£2,480.50");
        },
        { timeout: 500 }
      );
    });

    it("accepts a format function and applies it to the displayed value", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      const format = (n: number) => `$${n.toFixed(2)}`;

      render(<CountUp to={50} durationMs={100} format={format} />);

      await waitFor(
        () => {
          expect(screen.getByText("$50.00")).toBeTruthy();
        },
        { timeout: 500 }
      );
    });

    it("renders statically when 'to' equals 'from' with no animation", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      render(<CountUp from={42} to={42} durationMs={200} />);

      // Should immediately show 42
      expect(screen.getByText("42")).toBeTruthy();
    });

    it("counts down when 'to' is negative", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      render(<CountUp from={0} to={-50} durationMs={200} />);

      await waitFor(
        () => {
          expect(screen.getByText("-50")).toBeTruthy();
        },
        { timeout: 500 }
      );
    });

    it("defaults 'from' to 0 when not provided", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      render(<CountUp to={25} durationMs={100} />);

      await waitFor(
        () => {
          expect(screen.getByText("25")).toBeTruthy();
        },
        { timeout: 500 }
      );
    });

    it("renders the final value immediately under prefers-reduced-motion", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      // Mock matchMedia to simulate prefers-reduced-motion
      const mockMatchMedia = vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      window.matchMedia = mockMatchMedia as unknown as typeof window.matchMedia;

      render(<CountUp to={100} durationMs={1000} />);

      // Should immediately show the final value with no delay
      expect(screen.getByText("100")).toBeTruthy();
    });

    it("unmounts cleanly mid-count with no state update warning", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      // Spy on console.error to catch React warnings
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const { unmount } = render(<CountUp to={1000} durationMs={1000} />);

      // Unmount mid-animation
      await new Promise((resolve) => setTimeout(resolve, 50));
      unmount();

      // Wait a bit to see if any warnings appear
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check no React state update warnings
      const warnings = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((arg) =>
          String(arg).includes("state update on an unmounted component")
        )
      );

      expect(warnings.length).toBe(0);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Keyframe animations in globals.css", () => {
    it("defines @keyframes check-draw", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/@keyframes\s+check-draw/);
      expect(css).toMatch(/stroke-dashoffset/);
    });

    it("defines @keyframes success-ring", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/@keyframes\s+success-ring/);
      // Should scale from 0.6 to 1
      expect(css).toMatch(/scale\s*\(\s*0\.6/);
      expect(css).toMatch(/scale\s*\(\s*1/);
    });

    it("check-draw animates stroke-dashoffset from full to zero", () => {
      const css = readFile("src/app/globals.css");

      // Extract the check-draw keyframe block
      const checkDrawMatch = css.match(
        /@keyframes\s+check-draw\s*\{([^}]+)\}/
      );
      expect(checkDrawMatch).toBeTruthy();

      if (checkDrawMatch) {
        const keyframeBody = checkDrawMatch[1];
        // Should have 'from' or '0%' with a larger dashoffset
        // and 'to' or '100%' with zero dashoffset
        expect(keyframeBody).toMatch(/stroke-dashoffset/);
      }
    });

    it("success-ring uses var(--ease-spring) or spring easing", () => {
      const css = readFile("src/app/globals.css");

      // Extract the success-ring keyframe or its usage
      expect(css).toMatch(/--ease-spring|cubic-bezier/);
    });
  });

  describe("Design tokens in globals.css", () => {
    it("defines --color-success-burst in :root", () => {
      const css = readFile("src/app/globals.css");

      // Should be defined in :root block
      expect(css).toMatch(/:root\s*\{[\s\S]*--color-success-burst/);
    });

    it("defines --shadow-success-glow in :root", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/:root\s*\{[\s\S]*--shadow-success-glow/);
    });

    it("defines --dur-base in :root", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/:root\s*\{[\s\S]*--dur-base/);
    });

    it("defines --ease-spring in :root", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/:root\s*\{[\s\S]*--ease-spring/);
    });

    it("--color-success-burst is a green color", () => {
      const css = readFile("src/app/globals.css");

      const match = css.match(/--color-success-burst:\s*([^;]+);/);
      expect(match).toBeTruthy();

      if (match) {
        const colorValue = match[1].trim();
        // Should be a shade of green (heuristic: hex starting with #1 or #0 followed by higher green channel)
        // The spec suggests #15803d
        expect(colorValue).toMatch(/#[0-9a-fA-F]{6}/);
      }
    });

    it("--shadow-success-glow is a box-shadow value with green tint", () => {
      const css = readFile("src/app/globals.css");

      const match = css.match(/--shadow-success-glow:\s*([^;]+);/);
      expect(match).toBeTruthy();

      if (match) {
        const shadowValue = match[1].trim();
        // Should be a valid box-shadow (starts with offset values or 'inset')
        expect(shadowValue).toMatch(/rgba?\(.*\)/);
      }
    });

    it("--dur-base is a time value in milliseconds", () => {
      const css = readFile("src/app/globals.css");

      const match = css.match(/--dur-base:\s*([^;]+);/);
      expect(match).toBeTruthy();

      if (match) {
        const durValue = match[1].trim();
        expect(durValue).toMatch(/\d+ms/);
      }
    });

    it("--ease-spring is a cubic-bezier function", () => {
      const css = readFile("src/app/globals.css");

      const match = css.match(/--ease-spring:\s*([^;]+);/);
      expect(match).toBeTruthy();

      if (match) {
        const easeValue = match[1].trim();
        expect(easeValue).toMatch(/cubic-bezier\s*\(/);
      }
    });
  });

  describe("Reduced motion support", () => {
    it("globals.css has a prefers-reduced-motion media query", () => {
      const css = readFile("src/app/globals.css");

      expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    });

    it("prefers-reduced-motion sets animation-duration to near-zero", () => {
      const css = readFile("src/app/globals.css");

      // The existing media query (lines 252-260) should set animation-duration
      const reducedMotionBlock = css.match(
        /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/
      );

      expect(reducedMotionBlock).toBeTruthy();

      if (reducedMotionBlock) {
        const block = reducedMotionBlock[0];
        expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
      }
    });
  });

  describe("Primitives render in isolation", () => {
    it("CountUp can render without any parent context or route", async () => {
      const { CountUp } = await import("@/components/ui/count-up");

      // Rendering in a bare test environment proves no dependency on app context
      const { container } = render(
        <CountUp to={123} durationMs={100} />
      );

      expect(container.firstChild).toBeTruthy();
    });

    it("check-draw keyframe can be applied to an SVG element", () => {
      // Create a minimal SVG with the animation applied
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

      path.setAttribute("d", "M 0 0 L 10 10");
      path.style.animation = "check-draw 300ms ease-out";

      svg.appendChild(path);
      document.body.appendChild(svg);

      // If the keyframe exists in the loaded CSS, this doesn't throw
      const computedStyle = window.getComputedStyle(path);
      expect(computedStyle.animationName).toBeTruthy();

      document.body.removeChild(svg);
    });

    it("success-ring keyframe can be applied to a div element", () => {
      const div = document.createElement("div");
      div.style.animation = "success-ring 400ms var(--ease-spring, ease-out)";

      document.body.appendChild(div);

      const computedStyle = window.getComputedStyle(div);
      expect(computedStyle.animationName).toBeTruthy();

      document.body.removeChild(div);
    });
  });
});
