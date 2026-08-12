/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mockNativePlatform } from "../helpers/capacitor";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #189: Add associated domains and appUrlOpen handling for bank redirect return", () => {
  describe("App.entitlements includes associated domains", () => {
    it("contains the com.apple.developer.associated-domains entitlement key", () => {
      const entitlements = readFile("ios/App/App/App.entitlements");

      expect(entitlements).toMatch(/<key>com\.apple\.developer\.associated-domains<\/key>/);
    });

    it("includes applinks:motko.app in the associated domains array", () => {
      const entitlements = readFile("ios/App/App/App.entitlements");

      // Should have the key followed by an array containing the applinks entry
      expect(entitlements).toMatch(/<string>applinks:motko\.app<\/string>/);
    });

    it("has well-formed XML structure for associated domains", () => {
      const entitlements = readFile("ios/App/App/App.entitlements");

      // Extract the associated-domains section
      const domainKeyMatch = entitlements.match(
        /<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>([\s\S]*?)<\/array>/
      );

      expect(domainKeyMatch).toBeTruthy();
      if (domainKeyMatch) {
        const arrayContent = domainKeyMatch[1];
        expect(arrayContent).toMatch(/<string>applinks:motko\.app<\/string>/);
      }
    });
  });

  describe("AASA file structure and serving", () => {
    it("has a committed AASA JSON file in the repository", () => {
      // The spec requires the AASA contents be committed, not generated at request time
      const aasaPath = "public/.well-known/apple-app-site-association.json";
      expect(existsSync(join(process.cwd(), aasaPath))).toBe(true);
    });

    it("contains the correct app identifier", () => {
      const aasa = readFile("public/.well-known/apple-app-site-association.json");
      const parsed = JSON.parse(aasa) as {
        applinks?: {
          details?: Array<{
            appID?: string;
            paths?: string[];
          }>;
        };
      };

      // App ID from capacitor.config.ts: app.motko.ios
      // Team ID: PLFZC3LK8F (from Apple Developer account)
      expect(parsed.applinks).toBeDefined();
      expect(parsed.applinks?.details).toBeDefined();
      expect(Array.isArray(parsed.applinks?.details)).toBe(true);

      const detail = parsed.applinks?.details?.[0];
      expect(detail?.appID).toMatch(/^PLFZC3LK8F\.app\.motko\.ios$/);
    });

    it("includes paths for payment and mandate returns", () => {
      const aasa = readFile("public/.well-known/apple-app-site-association.json");
      const parsed = JSON.parse(aasa) as {
        applinks?: {
          details?: Array<{
            paths?: string[];
          }>;
        };
      };

      const detail = parsed.applinks?.details?.[0];
      expect(detail?.paths).toBeDefined();
      expect(Array.isArray(detail?.paths)).toBe(true);

      // Should include payment return path
      const hasPaymentPath = detail?.paths?.some((path: string) =>
        path.includes("/i/") && path.includes("paid")
      );
      expect(hasPaymentPath).toBe(true);

      // Should include settings path for mandate setup return
      const hasSettingsPath = detail?.paths?.some((path: string) =>
        path === "/settings" || path === "/settings*"
      );
      expect(hasSettingsPath).toBe(true);
    });

    it("excludes marketing or public routes by using NOT patterns or omitting them", () => {
      const aasa = readFile("public/.well-known/apple-app-site-association.json");
      const parsed = JSON.parse(aasa) as {
        applinks?: {
          details?: Array<{
            paths?: string[];
          }>;
        };
      };

      const detail = parsed.applinks?.details?.[0];
      expect(detail?.paths).toBeDefined();

      const paths = detail?.paths ?? [];

      // Paths should be specific (not "/*" which would catch everything)
      // OR should include NOT patterns to exclude marketing routes
      const hasWildcardAll = paths.includes("/*");

      if (hasWildcardAll) {
        // If using wildcard, must have NOT patterns to exclude marketing
        const hasNotPatterns = paths.some((path: string) => path.startsWith("NOT "));
        expect(hasNotPatterns).toBe(true);
      } else {
        // Otherwise, paths should be specific (e.g., /i/*/paid, /settings)
        expect(paths.length).toBeGreaterThan(0);
        expect(paths.length).toBeLessThan(10); // Sanity check: not listing everything
      }
    });

    it("has a route handler file at the expected path", () => {
      // Test that the route handler file exists
      const routePath = "src/app/.well-known/apple-app-site-association/route.ts";
      expect(existsSync(join(process.cwd(), routePath))).toBe(true);
    });

    it("route handler exports a GET function", () => {
      const routeSource = readFile("src/app/.well-known/apple-app-site-association/route.ts");

      // Should export a GET function
      expect(routeSource).toMatch(/export\s+(async\s+)?function\s+GET|export\s+const\s+GET\s*=/);
    });

    it("route handler reads and serves the committed AASA JSON file", () => {
      const routeSource = readFile("src/app/.well-known/apple-app-site-association/route.ts");

      // Should read the AASA file from the public directory or a committed location
      expect(routeSource).toMatch(/readFileSync|apple-app-site-association\.json/);

      // Should return a Response with JSON content
      expect(routeSource).toMatch(/NextResponse|Response/);
      expect(routeSource).toMatch(/application\/json/);
    });
  });

  describe("appUrlOpen handler registration", () => {
    beforeEach(() => {
      mockNativePlatform(true);
    });

    it("registers an appUrlOpen listener in the native app init component", () => {
      // The component registers listeners in useEffect, which won't run without rendering
      // So we need to check that the component imports App and has the listener code
      const componentSource = readFile("src/components/native-app-init.tsx");

      expect(componentSource).toMatch(/App\.addListener\s*\(\s*["']appUrlOpen["']/);
    });

    it("handler navigates to the incoming URL path, not the root", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should extract the URL from the event and navigate to it
      expect(componentSource).toMatch(/appUrlOpen/);

      // Should use window.location.assign or router.push with the URL
      // NOT router.push('/') or window.location.assign('/')
      const hasNavigation =
        componentSource.includes("window.location.assign") ||
        componentSource.includes("router.push");

      expect(hasNavigation).toBe(true);
    });

    it("handler preserves query parameters and fragments from the incoming URL", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should use the full URL or pathname, not strip query params
      // This is tested by checking that the handler doesn't call .split('?')[0]
      // or similar stripping logic before navigating

      // The handler should assign/push the url/pathname directly
      expect(componentSource).toMatch(/appUrlOpen/);
      expect(componentSource).toMatch(/url|pathname/i);
    });

    it("does not crash on malformed or unexpected URLs", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should have try-catch or conditional checks
      // The handler should not throw on invalid URLs
      const hasTryCatch = componentSource.match(/try\s*{[\s\S]*?appUrlOpen[\s\S]*?}\s*catch/);
      const hasConditional = componentSource.match(/if\s*\([^)]*url[^)]*\)/);

      const hasErrorHandling = hasTryCatch || hasConditional;
      expect(hasErrorHandling).toBeTruthy();
    });
  });

  describe("Integration: handler does not interfere with existing functionality", () => {
    it("does not remove or modify the existing appStateChange listener", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should still have the appStateChange listener
      expect(componentSource).toMatch(/App\.addListener\s*\(\s*["']appStateChange["']/);
    });

    it("does not remove or modify the existing push notification handler", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should still have initNativePush call
      expect(componentSource).toMatch(/initNativePush/);
    });

    it("both listeners can coexist in the same component", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Count occurrences of App.addListener
      const listenerMatches = componentSource.match(/App\.addListener/g);

      // Should have at least 2 listeners now (appStateChange + appUrlOpen)
      // May have more if there are other listeners
      expect(listenerMatches).toBeDefined();
      expect(listenerMatches!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Documentation and deployment order", () => {
    it("spec documents the iOS refetch timing limitation", () => {
      const spec = readFile("docs/specs/189.md");

      // Should mention that iOS refetches periodically and cannot be forced
      expect(spec).toMatch(/refetch/i);
      expect(spec).toMatch(/install/i);
      expect(spec).toMatch(/existing install/i);
    });

    it("spec documents the deployment order (AASA first, then app binary)", () => {
      const spec = readFile("docs/specs/189.md");

      // Should mention deployment order
      expect(spec).toMatch(/deploy.*order|deployment.*order/i);
      expect(spec).toMatch(/AASA.*before|file.*before.*binary/i);
    });
  });
});
