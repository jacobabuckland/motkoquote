/**
 * @vitest-environment happy-dom
 *
 * Acceptance tests for Issue #355: Get the app — a post-signup step for web signups
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);

describe("Issue #355: Get the app step for web signups", () => {
  describe("Route structure", () => {
    it("creates the get-app page component", async () => {
      const mod = await import("@/app/get-app/page");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("creates a loading component for the get-app route", async () => {
      const mod = await import("@/app/get-app/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });
  });

  describe("Uses existing helpers", () => {
    it("imports resolveAppStoreHref from lib/app-store-link", async () => {
      // Verify the helper exists and will be used
      const { resolveAppStoreHref } = await import("@/lib/app-store-link");
      expect(typeof resolveAppStoreHref).toBe("function");

      // The page should be importable (which would fail if it has bad imports)
      const pageMod = await import("@/app/get-app/page");
      expect(pageMod.default).toBeDefined();
    });

    it("can access NATIVE_SHELL_UA_TAG from lib/app-home", async () => {
      // Verify the constant exists and can be imported
      const appHomeMod = await import("@/lib/app-home");
      expect(appHomeMod.NATIVE_SHELL_UA_TAG).toBeDefined();
      expect(typeof appHomeMod.NATIVE_SHELL_UA_TAG).toBe("string");
      expect(appHomeMod.NATIVE_SHELL_UA_TAG).toBe("MotkoApp");

      // Note: The actual check was added in PR #350, so this just verifies
      // the constant remains available for the page to use
    });
  });

  describe("Signup flow redirect", () => {
    it("signup page exists and can be imported", async () => {
      const mod = await import("@/app/signup/page");
      expect(mod.default).toBeDefined();
    });

    it("signup page redirects to get-app when session is returned", async () => {
      // Read the signup page source to verify it redirects to /get-app
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const signupPath = join(process.cwd(), "src/app/signup/page.tsx");
      const source = readFileSync(signupPath, "utf-8");

      // Should push to /get-app when data.session exists
      expect(source).toContain('router.push("/get-app")');

      // Should not push directly to /setup on session return anymore
      // (the old path that this replaces)
      const lines = source.split("\n");
      const sessionBlock = lines.findIndex(
        (line) => line.includes("if (data.session)") || line.includes("if(data.session)"),
      );

      expect(sessionBlock).toBeGreaterThan(-1);

      // Check the lines following the session check
      const blockLines = lines.slice(sessionBlock, sessionBlock + 5).join("\n");
      expect(blockLines).toContain("/get-app");
    });
  });

  describe("Forbidden content", () => {
    it("does not mention searching the App Store", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");
      const lowerContent = content.toLowerCase();

      // Must not tell users to search for the app
      // (this was the regression from the first attempt - see issue ANSWERS section)
      expect(lowerContent).not.toContain("search");
    });

    it("does not mention Google Play or Android", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");
      const lowerContent = content.toLowerCase();

      // iOS only - no Android support exists
      expect(lowerContent).not.toContain("google play");
      expect(lowerContent).not.toContain("android");
    });
  });

  describe("Design and component usage", () => {
    it("uses the Button component from ui/button", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");

      // Should import Button from the UI components
      expect(content).toContain('@/components/ui/button');
    });

    it("uses router.push for navigation, not window.location", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");

      // Should use router.push, not window.location.href
      expect(content).not.toContain("window.location");

      // If it's a client component with navigation, should import useRouter
      if (content.includes('"use client"')) {
        expect(content).toContain("useRouter");
      }
    });

    it("does not use raw Tailwind color classes", async () => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");

      // Should not use raw colors like bg-gray-50, border-gray-300
      // (this was a problem in the first attempt)
      expect(content).not.toContain("bg-gray-");
      expect(content).not.toContain("border-gray-");
      expect(content).not.toContain("text-gray-");
    });
  });

  describe("App Store URL behavior", () => {
    it("resolveAppStoreHref returns null when URL is not configured", async () => {
      const { resolveAppStoreHref } = await import("@/lib/app-store-link");

      // Default state (as in .env.example) — no URL configured
      const result = resolveAppStoreHref(undefined);
      expect(result).toBeNull();

      // Empty string should also return null
      const emptyResult = resolveAppStoreHref("");
      expect(emptyResult).toBeNull();
    });

    it("resolveAppStoreHref returns the URL when configured", async () => {
      const { resolveAppStoreHref } = await import("@/lib/app-store-link");

      const testUrl = "https://apps.apple.com/gb/app/motko/id123456789";
      const result = resolveAppStoreHref(testUrl);

      expect(result).toBe(testUrl);
    });
  });

  describe("Regression prevention", () => {
    it("is the first caller of resolveAppStoreHref in src/", async () => {
      // The regression test in tests/regression/app-store-link.test.ts
      // previously asserted that resolveAppStoreHref had NO callers in src/.
      // This feature changes that — /get-app is now the sanctioned caller.

      const { readFileSync, readdirSync, statSync } = await import("node:fs");
      const { join, extname } = await import("node:path");

      const sourceFiles = (dir: string): string[] =>
        readdirSync(dir).flatMap((entry) => {
          const path = join(dir, entry);
          if (statSync(path).isDirectory()) return sourceFiles(path);
          return [".ts", ".tsx"].includes(extname(path)) ? [path] : [];
        });

      const callers = sourceFiles("src").filter(
        (file) =>
          !file.includes(".test.") &&
          file !== "src/lib/app-store-link.ts" &&
          readFileSync(file, "utf8").includes("resolveAppStoreHref"),
      );

      // Should have exactly one caller: the get-app page
      expect(callers.length).toBe(1);
      expect(callers[0]).toContain("src/app/get-app/page.tsx");
    });

    it("does not bring back apps.apple.com literals", async () => {
      // The regression test checks that no apps.apple.com literals exist in src/.
      // This page should use the helper, not a hardcoded URL.

      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      const pagePath = join(process.cwd(), "src/app/get-app/page.tsx");
      const content = readFileSync(pagePath, "utf-8");

      // Should not contain apps.apple.com as a string literal
      expect(content).not.toContain("apps.apple.com");
    });
  });
});
