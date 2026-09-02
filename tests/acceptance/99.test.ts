import { describe, expect, it, beforeEach, vi } from "vitest";
import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Mock Supabase client to avoid requiring real credentials in tests
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

// Helper to construct a minimal NextRequest for testing the public route logic.
// We only need pathname and cookie access — the rest can be stubbed.
const requestFor = (pathname: string): NextRequest => {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    nextUrl: {
      pathname,
      clone: () => {
        const cloned = new URL(url);
        return Object.assign(cloned, { pathname: cloned.pathname });
      },
    },
    url: url.href,
    cookies: {
      getAll: () => [],
      set: () => {},
    },
  } as unknown as NextRequest;
};

// Known public API routes as of branch factory/99 @ bea238f
// These are discovered by walking src/app/api/ and should match exactly.
const CURRENT_PUBLIC_API_ROUTES = [
  // Registered when the guest quote flow landed: mints an OpenAI Realtime token
  // for someone with no account. Reads no table, writes no table; rate limited
  // per caller and fails closed.
  "/api/guest/realtime-session",
  "/api/quotes/[id]/pdf",
  "/api/contracts/[id]/pdf",
  // Registered by the payment-pending fix. The customer's return page polls it
  // to resolve "Payment pending" into a receipt or an explicit failure. Public
  // to the middleware exactly as the pay page and receipt it sits between are,
  // and reached by the same bare invoice id. Returns state, amount and paidAt
  // only — no customer or contractor identity, no bank details, no Stripe ids
  // — and writes nothing.
  "/api/invoices/[id]/payment-status",
  // Registered by the fee-bypass fix. Serves the trade's payout account so a
  // customer can still pay when an available Stripe rail fails them. Public to
  // the middleware exactly as the pay page it is reached from; 404s for an
  // unknown invoice, a paid one, or a contractor with no payout account, all
  // indistinguishably.
  "/api/invoices/[id]/transfer-details",
  "/api/stripe/create-payment-intent",
  "/api/stripe/webhook",
  "/api/twilio/inbound",
  "/api/cron/chase",
  "/api/cron/reconcile-free-jobs",
  // Added by #240 (PAY-8). Public to the middleware exactly as its three
  // siblings above are: it carries no session and is gated instead by
  // rejectUnauthorizedCron, which is the first statement in the handler and
  // returns before any client is created. Reads invoices, writes nothing.
  "/api/cron/report-off-rails-invoices",
] as const;

// Known protected API routes
const CURRENT_PROTECTED_API_ROUTES = [
  "/api/companies-house/search",
  "/api/jobs/[id]/sow-pdf",
  "/api/ledger/query-session",
  "/api/push/subscribe",
  "/api/push/test",
] as const;

// Recursively walk a directory and find all route.ts files
const findRouteFiles = (dir: string, base = ""): string[] => {
  const entries = readdirSync(dir);
  const routes: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Next.js route segments: [id] is dynamic, [...slug] is catch-all, [[...slug]] is optional catch-all
      const segment = entry;
      routes.push(...findRouteFiles(fullPath, `${base}/${segment}`));
    } else if (entry === "route.ts") {
      // Found a route handler — normalize the path
      routes.push(base);
    }
  }

  return routes;
};

describe("Issue #99: Tighten middleware prefix allowlist to explicit routes", () => {
  beforeEach(() => {
    // Stub Supabase env vars so middleware can initialize without real credentials
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  describe("Explicit route enumeration", () => {
    it("lists all currently public API routes exactly", () => {
      // This test documents the current state. After implementation, the middleware
      // should have a PUBLIC_API_ROUTES constant that matches this list exactly.
      expect(CURRENT_PUBLIC_API_ROUTES).toEqual([
        "/api/guest/realtime-session",
        "/api/quotes/[id]/pdf",
        "/api/contracts/[id]/pdf",
        "/api/invoices/[id]/payment-status",
        "/api/invoices/[id]/transfer-details",
        "/api/stripe/create-payment-intent",
        "/api/stripe/webhook",
        "/api/twilio/inbound",
        "/api/cron/chase",
              "/api/cron/reconcile-free-jobs",
        "/api/cron/report-off-rails-invoices",
      ]);
    });

    it("finds all API routes in the codebase and ensures they are classified", () => {
      const apiDir = join(process.cwd(), "src/app/api");
      const routesFound = findRouteFiles(apiDir, "/api");

      const allClassified = [
        ...CURRENT_PUBLIC_API_ROUTES,
        ...CURRENT_PROTECTED_API_ROUTES,
      ];

      const unclassified = routesFound.filter(
        (route) => !allClassified.includes(route as never),
      );

      if (unclassified.length > 0) {
        throw new Error(
          `Routes found but not classified:\n${unclassified.join("\n")}\n\n` +
            `Every API route must be listed in either CURRENT_PUBLIC_API_ROUTES or CURRENT_PROTECTED_API_ROUTES.`,
        );
      }

      expect(unclassified).toEqual([]);
    });

    it("fails if a listed route no longer exists (stale list detection)", () => {
      const apiDir = join(process.cwd(), "src/app/api");
      const routesFound = findRouteFiles(apiDir, "/api");

      const allClassified = [
        ...CURRENT_PUBLIC_API_ROUTES,
        ...CURRENT_PROTECTED_API_ROUTES,
      ];

      const stale = allClassified.filter(
        (route) => !routesFound.includes(route as never),
      );

      if (stale.length > 0) {
        throw new Error(
          `Routes listed but not found in codebase (stale):\n${stale.join("\n")}\n\n` +
            `Remove these from the classification lists.`,
        );
      }

      expect(stale).toEqual([]);
    });
  });

  describe("Dynamic segment matching (post-implementation)", () => {
    // These tests describe the expected behaviour after implementation.
    // They will fail initially because the current middleware uses prefix matching.

    it("matches a concrete ID against the [id] pattern for quotes", async () => {
      const req = requestFor("/api/quotes/abc123/pdf");

      // EXPECTED BEHAVIOUR (will fail with current prefix-based implementation):
      // After implementation, this route should be recognized as public because
      // /api/quotes/[id]/pdf is in PUBLIC_API_ROUTES.
      //
      // Current behaviour: public via /api/quotes/ prefix match.
      // New behaviour: public via explicit /api/quotes/[id]/pdf pattern match.
      //
      // This test documents that the behaviour should NOT change for this route,
      // but the mechanism should switch from prefix to pattern.

      const response = await updateSession(req);

      // If the route is public, updateSession should NOT redirect to /login.
      // It should return a NextResponse.next() (or equivalent) without redirecting.
      //
      // We can't easily assert the internal implementation, so we check the observable:
      // - If redirected to /login, the response status is 307 and location is /login
      // - If public, the response is not a redirect (or is a passthrough response)
      //
      // NOTE: This test assumes no authenticated user session (cookies.getAll returns []).
      // A public route should NOT redirect even without a session.

      expect(response.status).not.toBe(307); // Should not redirect
      const location = response.headers.get("location");
      if (location) {
        expect(location).not.toContain("/login");
      }
    });

    it("matches various ID formats against the [id] pattern", async () => {
      const testCases = [
        "/api/quotes/abc123/pdf",
        "/api/quotes/quote_456/pdf",
        "/api/quotes/q-789/pdf",
        "/api/contracts/c123/pdf",
      ];

      for (const pathname of testCases) {
        const req = requestFor(pathname);
        const response = await updateSession(req);

        expect(response.status).not.toBe(307);
        const location = response.headers.get("location");
        if (location) {
          expect(location).not.toContain("/login");
        }
      }
    });

    it("protects a new route under an existing prefix that is not in the allowlist", async () => {
      // Hypothetical: an engineer adds /api/quotes/[id]/internal-costs/route.ts
      // This should NOT be public because it's not in PUBLIC_API_ROUTES.

      const req = requestFor("/api/quotes/abc123/internal-costs");
      const response = await updateSession(req);

      // EXPECTED BEHAVIOUR:
      // Current (prefix-based): public because it starts with /api/quotes/
      // New (explicit list): protected because /api/quotes/[id]/internal-costs is not listed
      //
      // This test will FAIL with the current implementation (it will be public).
      // After implementation, it should PASS (redirect to /login).

      expect(response.status).toBe(307); // Should redirect
      expect(response.headers.get("location")).toContain("/login");
    });

    it("protects a new cron route not explicitly listed", async () => {
      // Hypothetical: an engineer adds /api/cron/new-task/route.ts without adding it to PUBLIC_API_ROUTES

      const req = requestFor("/api/cron/new-task");
      const response = await updateSession(req);

      // EXPECTED BEHAVIOUR:
      // Current: public via /api/cron/ prefix
      // New: protected (redirect to /login) because not in PUBLIC_API_ROUTES
      //
      // This is the desired fail-closed behaviour.

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login");
    });
  });

  describe("Existing public routes remain public (regression prevention)", () => {
    it("allows /api/stripe/webhook (exact match, no dynamic segment)", async () => {
      const req = requestFor("/api/stripe/webhook");
      const response = await updateSession(req);

      expect(response.status).not.toBe(307);
      const location = response.headers.get("location");
      if (location) {
        expect(location).not.toContain("/login");
      }
    });

    it("allows /api/twilio/inbound", async () => {
      const req = requestFor("/api/twilio/inbound");
      const response = await updateSession(req);

      expect(response.status).not.toBe(307);
      const location = response.headers.get("location");
      if (location) {
        expect(location).not.toContain("/login");
      }
    });

    it("allows all cron routes", async () => {
      const cronRoutes = [
        "/api/cron/chase",
              "/api/cron/reconcile-free-jobs",
        "/api/cron/report-off-rails-invoices",
      ];

      for (const pathname of cronRoutes) {
        const req = requestFor(pathname);
        const response = await updateSession(req);

        expect(response.status).not.toBe(307);
        const location = response.headers.get("location");
        if (location) {
          expect(location).not.toContain("/login");
        }
      }
    });
  });

  describe("Protected routes remain protected", () => {
    it("protects /api/companies-house/search (not under any previously public prefix)", async () => {
      const req = requestFor("/api/companies-house/search");
      const response = await updateSession(req);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login");
    });

    it("protects /api/jobs/[id]/sow-pdf", async () => {
      const req = requestFor("/api/jobs/job123/sow-pdf");
      const response = await updateSession(req);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/login");
    });

    it("protects /api/push/* routes", async () => {
      const pushRoutes = ["/api/push/subscribe", "/api/push/test"];

      for (const pathname of pushRoutes) {
        const req = requestFor(pathname);
        const response = await updateSession(req);

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toContain("/login");
      }
    });
  });

  describe("Non-API public routes remain unchanged", () => {
    it("allows homepage /", async () => {
      const req = requestFor("/");
      const response = await updateSession(req);

      expect(response.status).not.toBe(307);
      const location = response.headers.get("location");
      if (location) {
        expect(location).not.toContain("/login");
      }
    });

    it("allows /login, /signup, /auth, /privacy, /support prefixes", async () => {
      const publicPages = [
        "/login",
        "/signup",
        "/auth/callback",
        "/privacy",
        "/support",
      ];

      for (const pathname of publicPages) {
        const req = requestFor(pathname);
        const response = await updateSession(req);

        expect(response.status).not.toBe(307);
        const location = response.headers.get("location");
        if (location) {
          expect(location).not.toContain("/login");
        }
      }
    });

    it("allows share links /q/, /i/, /c/", async () => {
      const shareLinks = ["/q/abc123", "/i/inv456", "/c/contract789"];

      for (const pathname of shareLinks) {
        const req = requestFor(pathname);
        const response = await updateSession(req);

        expect(response.status).not.toBe(307);
        const location = response.headers.get("location");
        if (location) {
          expect(location).not.toContain("/login");
        }
      }
    });
  });
});
