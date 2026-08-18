// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import jest-dom matchers for @testing-library assertions
import "@testing-library/jest-dom/vitest";

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";

// Load globals.css into happy-dom environment for tests that need keyframes/tokens
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll } from "vitest";

beforeAll(() => {
  // Only inject CSS in happy-dom environment (browser-like tests)
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    try {
      const cssPath = join(process.cwd(), "src/app/globals.css");
      let css = readFileSync(cssPath, "utf-8");

      // Remove @import directives that happy-dom can't process
      // These would be resolved by the build tool in production
      css = css.replace(/@import\s+[^;]+;/g, "");

      // Create and inject a style element with the CSS
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);

      // Happy-dom has limited CSS animation support. Patch getComputedStyle to
      // properly extract animationName from the animation shorthand property.
      const originalGetComputedStyle = window.getComputedStyle;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).getComputedStyle = function (
        element: Element,
        pseudoElt?: string | null
      ): CSSStyleDeclaration {
        const computed = originalGetComputedStyle.call(
          this,
          element,
          pseudoElt
        );

        // Create a proxy that preserves the CSSStyleDeclaration instance
        return new Proxy(computed, {
          get(target, prop, receiver) {
            if (prop === "animationName") {
              // Extract animation name from the animation or animationName property
              const elem = element as HTMLElement | SVGElement;
              const animationProp = elem.style.animation || "";
              const animationNameProp = elem.style.animationName || "";

              // Parse animation shorthand (format: "name duration timing-function delay ...")
              if (animationProp) {
                const parts = animationProp.trim().split(/\s+/);
                if (parts.length > 0 && !parts[0].match(/^\d/)) {
                  // First part is the name if it doesn't start with a number
                  return parts[0];
                }
              }

              // Fall back to animationName property
              if (animationNameProp) {
                return animationNameProp;
              }

              // Fall back to the target's value
              return Reflect.get(target, prop, receiver);
            }

            // For all other properties and methods, use Reflect to preserve binding
            const value = Reflect.get(target, prop, receiver);

            // Bind functions to the original target to preserve 'this' context
            if (typeof value === "function") {
              return value.bind(target);
            }

            return value;
          },
        });
      };
    } catch {
      // Silently fail if CSS can't be loaded (e.g., in node environment)
      // Tests that need CSS will fail explicitly if it's missing
    }
  }
});
