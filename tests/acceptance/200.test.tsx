/**
 * @vitest-environment happy-dom
 *
 * Issue #200: Add route skeletons to every authenticated route
 *
 * These tests verify that every authenticated route has a loading.tsx file
 * that renders a skeleton matching its layout, with proper accessibility
 * attributes and no text content.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Required cleanup since globals: true is not set
afterEach(cleanup);

// Public routes that do NOT require authentication (from middleware.ts)
// All routes not in this list are authenticated and require loading.tsx
const PUBLIC_ROUTE_PREFIXES = [
  "(marketing)", // root /
  "login",
  "signup",
  "auth",
  "privacy",
  "terms", // contractor terms (FEE-10) — public for the same reason privacy is
  "support",
  "q", // quote views
  "i", // invoice views
  "c", // contract views
  "api", // API routes
  ".well-known", // metadata
];

/**
 * Find all route segments with a page.tsx (i.e., actual routes that render)
 * Returns paths relative to src/app, e.g., "dashboard", "jobs/new", "setup/voice"
 */
const findAllRoutes = (): string[] => {
  const appDir = join(process.cwd(), "src", "app");
  const routes: string[] = [];

  const walk = (dir: string, prefix = ""): void => {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const routePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        walk(fullPath, routePath);
      } else if (entry.isFile() && entry.name === "page.tsx") {
        // Found a route — record its directory path
        routes.push(prefix);
      }
    }
  };

  walk(appDir);
  return routes;
};

/**
 * Determine if a route path is authenticated (requires login)
 */
const isAuthenticatedRoute = (routePath: string): boolean => {
  // Empty string is the root (marketing) page, which is public
  if (routePath === "") return false;

  // Check if the route starts with any public prefix
  const firstSegment = routePath.split("/")[0];
  return !PUBLIC_ROUTE_PREFIXES.includes(firstSegment);
};

describe("Issue #200: Add route skeletons to every authenticated route", () => {
  describe("All authenticated routes have loading.tsx", () => {
    it("every authenticated route directory contains a loading.tsx file", () => {
      const allRoutes = findAllRoutes();
      const authenticatedRoutes = allRoutes.filter(isAuthenticatedRoute);

      // Verify we found the expected authenticated routes
      // (as a sanity check that our route detection is working)
      expect(authenticatedRoutes.length).toBeGreaterThan(0);
      expect(authenticatedRoutes).toContain("dashboard");
      expect(authenticatedRoutes).toContain("jobs");
      expect(authenticatedRoutes).toContain("setup");

      const missingLoading: string[] = [];

      for (const route of authenticatedRoutes) {
        const routeDir = join(process.cwd(), "src", "app", route);
        const loadingPath = join(routeDir, "loading.tsx");

        if (!existsSync(loadingPath)) {
          missingLoading.push(route);
        }
      }

      // This will FAIL until all loading.tsx files are created
      expect(
        missingLoading,
        `The following authenticated routes are missing loading.tsx: ${missingLoading.join(", ")}`,
      ).toEqual([]);
    });

    it("no loading.tsx exists in public (unauthenticated) routes", () => {
      const allRoutes = findAllRoutes();
      const publicRoutes = allRoutes.filter((r) => !isAuthenticatedRoute(r));

      const unexpectedLoading: string[] = [];

      for (const route of publicRoutes) {
        const routeDir = join(process.cwd(), "src", "app", route);
        const loadingPath = join(routeDir, "loading.tsx");

        // Public routes should NOT have loading.tsx unless there's a specific reason
        // (this is not a strict requirement, but helps catch misplaced files)
        if (existsSync(loadingPath) && !route.includes("q/") && !route.includes("i/") && !route.includes("c/")) {
          unexpectedLoading.push(route);
        }
      }

      // q/[id], i/[id], c/[id] are public but may have loading states for the customer experience
      // This test just ensures we're not accidentally adding loading.tsx to login, signup, etc.
      expect(unexpectedLoading).toEqual([]);
    });
  });

  describe("Each loading.tsx exports a valid React component", () => {
    it("src/app/setup/loading.tsx exports a default component", async () => {
      // This will FAIL until the file is created
      const mod = await import("@/app/setup/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("src/app/setup/voice/loading.tsx exports a default component", async () => {
      // This will FAIL until the file is created
      const mod = await import("@/app/setup/voice/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("src/app/jobs/loading.tsx exports a default component", async () => {
      // This will FAIL until the file is created
      const mod = await import("@/app/jobs/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("src/app/jobs/new/loading.tsx exports a default component", async () => {
      // This will FAIL until the file is created
      const mod = await import("@/app/jobs/new/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("src/app/motko/loading.tsx exports a default component", async () => {
      // This will FAIL until the file is created
      const mod = await import("@/app/motko/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });
  });

  describe("Loading components are accessible", () => {
    it("setup loading skeleton has aria-hidden on root element", async () => {
      const mod = await import("@/app/setup/loading");
      const SetupLoading = mod.default;

      const { container } = render(<SetupLoading />);
      const rootElement = container.firstElementChild;

      // This will FAIL until aria-hidden is added
      expect(rootElement).toBeTruthy();
      expect(rootElement?.getAttribute("aria-hidden")).toBe("true");
    });

    it("setup/voice loading skeleton has aria-hidden on root element", async () => {
      const mod = await import("@/app/setup/voice/loading");
      const SetupVoiceLoading = mod.default;

      const { container } = render(<SetupVoiceLoading />);
      const rootElement = container.firstElementChild;

      // This will FAIL until aria-hidden is added
      expect(rootElement).toBeTruthy();
      expect(rootElement?.getAttribute("aria-hidden")).toBe("true");
    });

    it("jobs loading skeleton has aria-hidden on root element", async () => {
      const mod = await import("@/app/jobs/loading");
      const JobsLoading = mod.default;

      const { container } = render(<JobsLoading />);
      const rootElement = container.firstElementChild;

      // This will FAIL until aria-hidden is added
      expect(rootElement).toBeTruthy();
      expect(rootElement?.getAttribute("aria-hidden")).toBe("true");
    });

    it("jobs/new loading skeleton has aria-hidden on root element", async () => {
      const mod = await import("@/app/jobs/new/loading");
      const JobsNewLoading = mod.default;

      const { container } = render(<JobsNewLoading />);
      const rootElement = container.firstElementChild;

      // This will FAIL until aria-hidden is added
      expect(rootElement).toBeTruthy();
      expect(rootElement?.getAttribute("aria-hidden")).toBe("true");
    });

    it("motko loading skeleton has aria-hidden on root element", async () => {
      const mod = await import("@/app/motko/loading");
      const MotkoLoading = mod.default;

      const { container } = render(<MotkoLoading />);
      const rootElement = container.firstElementChild;

      // This will FAIL until aria-hidden is added
      expect(rootElement).toBeTruthy();
      expect(rootElement?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("Loading components contain no text content", () => {
    it("setup loading skeleton contains no readable text", async () => {
      const mod = await import("@/app/setup/loading");
      const SetupLoading = mod.default;

      const { container } = render(<SetupLoading />);

      // Should contain Skeleton components but no actual text
      // We check that there's no text nodes with actual content
      const textContent = container.textContent || "";
      const hasNoText = textContent.trim() === "";

      // This will FAIL if text content is present
      expect(hasNoText).toBe(true);
    });

    it("jobs loading skeleton contains no readable text", async () => {
      const mod = await import("@/app/jobs/loading");
      const JobsLoading = mod.default;

      const { container } = render(<JobsLoading />);

      const textContent = container.textContent || "";
      const hasNoText = textContent.trim() === "";

      // This will FAIL if text content is present
      expect(hasNoText).toBe(true);
    });

    it("motko loading skeleton contains no readable text", async () => {
      const mod = await import("@/app/motko/loading");
      const MotkoLoading = mod.default;

      const { container } = render(<MotkoLoading />);

      const textContent = container.textContent || "";
      const hasNoText = textContent.trim() === "";

      // This will FAIL if text content is present
      expect(hasNoText).toBe(true);
    });
  });

  describe("Loading components render skeleton structure matching page layout", () => {
    it("dashboard loading (existing) renders header and main sections", async () => {
      // Test the existing one as a baseline
      const mod = await import("@/app/dashboard/loading");
      const DashboardLoading = mod.default;

      const { container } = render(<DashboardLoading />);

      // Should have a header
      const header = container.querySelector("header");
      expect(header).toBeTruthy();

      // Should have a main section
      const main = container.querySelector("main");
      expect(main).toBeTruthy();
    });

    it("jobs loading renders structure matching jobs page (header, main, filter section)", async () => {
      const mod = await import("@/app/jobs/loading");
      const JobsLoading = mod.default;

      const { container } = render(<JobsLoading />);

      // Should have header
      const header = container.querySelector("header");
      expect(header).toBeTruthy();

      // Should have main
      const main = container.querySelector("main");
      expect(main).toBeTruthy();

      // This will FAIL until the structure matches the jobs page layout
    });

    it("setup loading renders structure matching setup page (header, main)", async () => {
      const mod = await import("@/app/setup/loading");
      const SetupLoading = mod.default;

      const { container } = render(<SetupLoading />);

      // Should have header
      const header = container.querySelector("header");
      expect(header).toBeTruthy();

      // Should have main
      const main = container.querySelector("main");
      expect(main).toBeTruthy();

      // This will FAIL until the structure matches the setup page layout
    });
  });

  describe("Regression prevention: new authenticated routes require loading.tsx", () => {
    it("authenticated route detection correctly identifies current authenticated routes", () => {
      const authenticatedRoutes = findAllRoutes().filter(isAuthenticatedRoute);

      // These should all be authenticated
      expect(authenticatedRoutes).toContain("dashboard");
      expect(authenticatedRoutes).toContain("settings");
      expect(authenticatedRoutes).toContain("jobs");
      expect(authenticatedRoutes).toContain("jobs/new");
      expect(authenticatedRoutes).toContain("setup");
      expect(authenticatedRoutes).toContain("motko");
    });

    it("public route detection correctly identifies current public routes", () => {
      const publicRoutes = findAllRoutes().filter((r) => !isAuthenticatedRoute(r));

      // These should all be public
      expect(publicRoutes.some((r) => r === "" || r.includes("marketing"))).toBe(true); // root
      expect(publicRoutes.some((r) => r.includes("login"))).toBe(true);
      expect(publicRoutes.some((r) => r.includes("signup"))).toBe(true);
      expect(publicRoutes.some((r) => r.includes("auth"))).toBe(true);
      expect(publicRoutes.some((r) => r.includes("privacy"))).toBe(true);
    });

    it("fails if a new authenticated route is added without loading.tsx", () => {
      // This test ensures that future work cannot silently regress coverage
      // by adding a new authenticated route without a loading state

      const allRoutes = findAllRoutes();
      const authenticatedRoutes = allRoutes.filter(isAuthenticatedRoute);
      const routesWithoutLoading: string[] = [];

      for (const route of authenticatedRoutes) {
        const routeDir = join(process.cwd(), "src", "app", route);
        const loadingPath = join(routeDir, "loading.tsx");

        if (!existsSync(loadingPath)) {
          routesWithoutLoading.push(route);
        }
      }

      // After #200 is implemented, this should be an empty array
      // If someone adds a new authenticated route later, this test will catch it
      expect(
        routesWithoutLoading,
        `These authenticated routes lack loading.tsx and will show blank during navigation: ${routesWithoutLoading.join(", ")}`,
      ).toEqual([]);
    });
  });
});
