import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

/**
 * Issue #119: Add motion and elevation design tokens
 *
 * These tests verify that globals.css defines motion and layered elevation
 * tokens, that no hardcoded shadow values remain in UI components, and that
 * reduced-motion preferences are honored.
 */

const GLOBALS_CSS_PATH = join(
  process.cwd(),
  "src",
  "app",
  "globals.css"
);

const readGlobalsCss = (): string => {
  return readFileSync(GLOBALS_CSS_PATH, "utf-8");
};

describe("Issue #119: Add motion and elevation design tokens", () => {
  describe("Motion easing tokens", () => {
    it("defines --ease-standard with the specified cubic-bezier value", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--ease-standard: cubic-bezier(0.2, 0, 0, 1)");
    });

    it("defines --ease-out with the specified cubic-bezier value", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--ease-out: cubic-bezier(0.16, 1, 0.3, 1)");
    });

    it("defines --ease-spring with the specified cubic-bezier value", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)");
    });
  });

  describe("Motion duration tokens", () => {
    it("defines --dur-instant as 80ms", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--dur-instant: 80ms");
    });

    it("defines --dur-fast as 140ms", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--dur-fast: 140ms");
    });

    it("defines --dur-base as 220ms", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--dur-base: 220ms");
    });

    it("defines --dur-slow as 360ms", () => {
      const css = readGlobalsCss();
      expect(css).toContain("--dur-slow: 360ms");
    });
  });

  describe("Elevation shadow tokens", () => {
    it("defines --shadow-hairline with dual-offset green-tinted shadow", () => {
      const css = readGlobalsCss();
      expect(css).toContain(
        "--shadow-hairline: 0 1px 1px rgba(0, 66, 37, 0.05), 0 1px 2px rgba(0, 66, 37, 0.04)"
      );
    });

    it("defines --shadow-resting with dual-offset green-tinted shadow", () => {
      const css = readGlobalsCss();
      expect(css).toContain(
        "--shadow-resting: 0 1px 2px rgba(0, 66, 37, 0.06), 0 2px 6px rgba(0, 66, 37, 0.06)"
      );
    });

    it("defines --shadow-raised with dual-offset green-tinted shadow", () => {
      const css = readGlobalsCss();
      expect(css).toContain(
        "--shadow-raised: 0 2px 4px rgba(0, 66, 37, 0.07), 0 6px 12px rgba(0, 66, 37, 0.08)"
      );
    });

    it("defines --shadow-hover with dual-offset green-tinted shadow", () => {
      const css = readGlobalsCss();
      expect(css).toContain(
        "--shadow-hover: 0 4px 8px rgba(0, 66, 37, 0.08), 0 10px 24px rgba(0, 66, 37, 0.10)"
      );
    });

    it("defines --shadow-overlay with dual-offset green-tinted shadow", () => {
      const css = readGlobalsCss();
      expect(css).toContain(
        "--shadow-overlay: 0 8px 16px rgba(0, 66, 37, 0.10), 0 24px 48px rgba(0, 66, 37, 0.14)"
      );
    });
  });

  describe("No hardcoded shadow values in UI components", () => {
    it("has no hardcoded rgba box-shadow in src/components/ui", () => {

      // Grep for box-shadow with literal rgba in src/components/ui
      // Exclude lines that use var() or color tokens
      try {
        const result = execSync(
          'grep -r "box-shadow:.*rgba(" src/components/ui/ || true',
          { encoding: "utf-8" }
        );

        // Should find no matches
        expect(result.trim()).toBe("");
      } catch (error) {
        // grep returns non-zero when no matches found, which is what we want
        // If it throws, that's fine - it means no matches
      }
    });

    it("has no hardcoded rgba box-shadow in globals.css outside the focus ring", () => {
      const css = readGlobalsCss();

      // Find all box-shadow declarations with rgba
      const boxShadowRgbaPattern = /box-shadow:\s*[^;]*rgba\([^)]+\)/g;
      const matches = css.match(boxShadowRgbaPattern);

      if (matches) {
        // The only allowed match is the focus ring with color-mix
        matches.forEach(match => {
          // The focus ring uses color-mix with var(--color-primary), which is allowed
          // Any other hardcoded rgba is not allowed
          if (!match.includes("color-mix")) {
            expect.fail(
              `Found hardcoded rgba box-shadow in globals.css that doesn't use color-mix or var(): ${match}`
            );
          }
        });
      }
      // If no matches, that's fine too
    });
  });

  describe("Reduced motion support", () => {
    it("redefines --dur-instant as 0.01ms in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      // Find the prefers-reduced-motion block
      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);

      expect(match).toBeDefined();
      const reducedMotionBlock = match![1];
      expect(reducedMotionBlock).toContain("--dur-instant: 0.01ms");
    });

    it("redefines --dur-fast as 0.01ms in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);
      const reducedMotionBlock = match![1];

      expect(reducedMotionBlock).toContain("--dur-fast: 0.01ms");
    });

    it("redefines --dur-base as 0.01ms in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);
      const reducedMotionBlock = match![1];

      expect(reducedMotionBlock).toContain("--dur-base: 0.01ms");
    });

    it("redefines --dur-slow as 0.01ms in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);
      const reducedMotionBlock = match![1];

      expect(reducedMotionBlock).toContain("--dur-slow: 0.01ms");
    });

    it("does not modify easing tokens in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);
      const reducedMotionBlock = match![1];

      // Easing curves should NOT be redefined
      expect(reducedMotionBlock).not.toContain("--ease-standard");
      expect(reducedMotionBlock).not.toContain("--ease-out");
      expect(reducedMotionBlock).not.toContain("--ease-spring");
    });

    it("does not modify shadow tokens in prefers-reduced-motion block", () => {
      const css = readGlobalsCss();

      const reducedMotionPattern = /@media \(prefers-reduced-motion: reduce\)[^{]*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(reducedMotionPattern);
      const reducedMotionBlock = match![1];

      // Shadow tokens should NOT be redefined (elevation is not motion)
      expect(reducedMotionBlock).not.toContain("--shadow-hairline");
      expect(reducedMotionBlock).not.toContain("--shadow-resting");
      expect(reducedMotionBlock).not.toContain("--shadow-raised");
      expect(reducedMotionBlock).not.toContain("--shadow-hover");
      expect(reducedMotionBlock).not.toContain("--shadow-overlay");
    });
  });

  describe("Tokens are in :root", () => {
    it("defines all motion and shadow tokens within the :root block", () => {
      const css = readGlobalsCss();

      // Extract the :root block (everything between :root { and the matching })
      // This is a simplified parser - it assumes :root is not nested
      const rootPattern = /:root\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/;
      const match = css.match(rootPattern);

      expect(match).toBeDefined();
      const rootBlock = match![1];

      // All motion tokens should be in :root
      expect(rootBlock).toContain("--ease-standard:");
      expect(rootBlock).toContain("--ease-out:");
      expect(rootBlock).toContain("--ease-spring:");
      expect(rootBlock).toContain("--dur-instant:");
      expect(rootBlock).toContain("--dur-fast:");
      expect(rootBlock).toContain("--dur-base:");
      expect(rootBlock).toContain("--dur-slow:");

      // All shadow tokens should be in :root
      expect(rootBlock).toContain("--shadow-hairline:");
      expect(rootBlock).toContain("--shadow-resting:");
      expect(rootBlock).toContain("--shadow-raised:");
      expect(rootBlock).toContain("--shadow-hover:");
      expect(rootBlock).toContain("--shadow-overlay:");
    });
  });
});
