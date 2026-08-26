/**
 * @vitest-environment happy-dom
 *
 * Issue #352: A /join/<code> landing route for referral links
 *
 * The share link currently drops a referred trade straight onto /signup with no
 * context. A landing page that names the product and acknowledges the referral
 * gives the referee room to decide whether to proceed.
 *
 * Link shape is DECIDED (areas/motko.md, 2026-08-26): /join/<code> with ?ref=
 * kept working for backward compatibility.
 *
 * Persistence layer (src/lib/referral-capture.ts) already exists from PR #350.
 * This ticket is the landing route only.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

// Mock captureReferralCode so we can verify it's called and track what it returns
const mockCaptureReferralCode = vi.fn((href: string) => {
  // Simulate the real behavior: extract the code and store it
  const match = href.match(/\/join\/([A-Z0-9]{6})/);
  const code = match?.[1] ?? null;
  if (code) {
    // Simulate localStorage (the real function writes to it)
    window.localStorage.setItem("motko.referral-code", code);
  }
  return code;
});

const mockRecallReferralCode = vi.fn(() => {
  return window.localStorage.getItem("motko.referral-code");
});

// Mock the referral-capture module
vi.mock("@/lib/referral-capture", () => ({
  captureReferralCode: mockCaptureReferralCode,
  recallReferralCode: mockRecallReferralCode,
  forgetReferralCode: vi.fn(),
  REFERRAL_STORAGE_KEY: "motko.referral-code",
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // Set up window.location for tests
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "https://motko.app/join/TRADE9" },
  });
});

describe("Issue #352: /join/<code> landing route", () => {
  describe("Route files exist", () => {
    it("page.tsx exists and exports a default component", async () => {
      const mod = await import("@/app/join/[code]/page");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("loading.tsx exists and exports a default component", async () => {
      const loadingPath = join(
        process.cwd(),
        "src",
        "app",
        "join",
        "[code]",
        "loading.tsx",
      );
      expect(
        existsSync(loadingPath),
        "loading.tsx is required by tests/acceptance/200.test.tsx registry",
      ).toBe(true);

      const mod = await import("@/app/join/[code]/loading");
      expect(mod.default).toBeDefined();
    });
  });

  describe("Route is public (unauthenticated access)", () => {
    it("/join/ is listed in middleware public routes", async () => {
      const middlewarePath = join(
        process.cwd(),
        "src",
        "lib",
        "supabase",
        "middleware.ts",
      );
      expect(existsSync(middlewarePath)).toBe(true);

      // Read the middleware source to verify /join/ is public
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(middlewarePath, "utf-8");

      // Check that the isPublicRoute condition includes /join/
      // The condition should be: request.nextUrl.pathname.startsWith("/join/")
      const hasJoinRoute =
        source.includes('pathname.startsWith("/join/")')  ||
        source.includes("pathname.startsWith('/join/')");

      expect(
        hasJoinRoute,
        "/join/ must be added to public routes in middleware",
      ).toBe(true);
    });
  });

  describe("Landing page with valid code", () => {
    it("renders the landing page for a valid code", async () => {
      window.location.href = "https://motko.app/join/TRADE9";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "TRADE9" }} />);

      // Should mention Motko (the product name)
      expect(
        screen.queryByText(/motko/i),
        "landing page must name the product",
      ).toBeTruthy();
    });

    it("calls captureReferralCode on mount", async () => {
      window.location.href = "https://motko.app/join/TRADE9";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "TRADE9" }} />);

      expect(mockCaptureReferralCode).toHaveBeenCalled();
      expect(mockCaptureReferralCode).toHaveBeenCalledWith(
        expect.stringContaining("motko.app"),
      );
    });

    it("captures the code so it can be recalled later", async () => {
      window.location.href = "https://motko.app/join/TRADE9";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "TRADE9" }} />);

      // The code should now be held
      const recalled = mockRecallReferralCode();
      expect(recalled).toBe("TRADE9");
    });

    it("provides a way to proceed to signup", async () => {
      window.location.href = "https://motko.app/join/XYZ999";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "XYZ999" }} />);

      // Should have a link or button to proceed
      // Look for common patterns: "sign up", "create account", "get started", "continue"
      const proceedElement =
        screen.queryByRole("link", { name: /sign up|create|continue|get started/i }) ||
        screen.queryByRole("button", { name: /sign up|create|continue|get started/i });

      expect(
        proceedElement,
        "landing page must provide a way to proceed to signup",
      ).toBeTruthy();
    });
  });

  describe("Landing page with invalid code", () => {
    it("still renders with a code containing forbidden characters", async () => {
      // 'O' is forbidden (not in the alphabet)
      window.location.href = "https://motko.app/join/OLDXYZ";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "OLDXYZ" }} />);

      // Should still render the landing page
      expect(screen.queryByText(/motko/i)).toBeTruthy();
    });

    it("still allows proceeding to signup with invalid code", async () => {
      window.location.href = "https://motko.app/join/BADCODE";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "BADCODE" }} />);

      const proceedElement =
        screen.queryByRole("link", { name: /sign up|create|continue|get started/i }) ||
        screen.queryByRole("button", { name: /sign up|create|continue|get started/i });

      expect(
        proceedElement,
        "invalid code must not dead-end the signup journey",
      ).toBeTruthy();
    });

    it("still renders with a code that is too short", async () => {
      window.location.href = "https://motko.app/join/ABC";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "ABC" }} />);

      expect(screen.queryByText(/motko/i)).toBeTruthy();
    });

    it("still renders with a code that is too long", async () => {
      window.location.href = "https://motko.app/join/ABCDEFGH";

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code: "ABCDEFGH" }} />);

      expect(screen.queryByText(/motko/i)).toBeTruthy();
    });
  });

  describe("Valid example codes from the alphabet", () => {
    // These codes use only the valid alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789
    // No I, O, 0, or 1 (excluded because they're misread when spoken)
    const VALID_CODES = ["TRADE9", "XYZ999", "NEW888", "TEST99", "DAN4K2", "QRS789"];

    it.each(VALID_CODES)("renders and captures code: %s", async (code) => {
      window.location.href = `https://motko.app/join/${code}`;

      const JoinPage = (await import("@/app/join/[code]/page")).default;
      render(<JoinPage params={{ code }} />);

      expect(screen.queryByText(/motko/i)).toBeTruthy();
      expect(mockCaptureReferralCode).toHaveBeenCalled();
    });
  });

  describe("Backward compatibility", () => {
    it("?ref= on /signup still works (do not break existing regression test)", async () => {
      // This is a meta-assertion: the existing test
      // tests/regression/signup-referral-field.test.tsx covers this behavior
      // and must continue passing. We verify the test file exists but do NOT
      // import it (per AGENTS.md, importing one test file from another is wrong).
      const regressionTestPath = join(
        process.cwd(),
        "tests",
        "regression",
        "signup-referral-field.test.tsx",
      );

      expect(
        existsSync(regressionTestPath),
        "regression test for ?ref= must exist and keep passing",
      ).toBe(true);
    });
  });
});
