import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

describe("Issue #634: SEC-1 Remove bearer-token auth from middleware", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("Bearer token authentication is removed", () => {
    it("redirects to /login for authenticated routes even with a valid bearer token", async () => {
      // Mock Supabase to simulate what would happen: no user from cookie-based auth
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({ data: { user: null }, error: null }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      // Request to an authenticated route with a bearer token
      const request = {
        nextUrl: {
          pathname: "/dashboard",
          clone: () => new URL("https://motko.app/dashboard"),
        },
        url: "https://motko.app/dashboard",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer test-bearer-token-not-a-jwt",
        }),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // Should redirect to /login, not accept the bearer token
      expect(response.headers.get("location")).toBe("https://motko.app/login");
    });

    it("redirects to /login for authenticated API routes with bearer token", async () => {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({ data: { user: null }, error: null }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/api/jobs/create",
          clone: () => new URL("https://motko.app/api/jobs/create"),
        },
        url: "https://motko.app/api/jobs/create",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer valid-access-token-12345",
        }),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      expect(response.headers.get("location")).toBe("https://motko.app/login");
    });

    it("ignores bearer tokens on public routes (public routes stay public)", async () => {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({ data: { user: null }, error: null }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/q/abc123",
          clone: () => new URL("https://motko.app/q/abc123"),
        },
        url: "https://motko.app/q/abc123",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer some-token",
        }),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // No redirect - public route accessible, bearer token ignored
      expect(response.headers.get("location")).toBeNull();
    });

    it("ignores bearer tokens on public API routes", async () => {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({ data: { user: null }, error: null }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/api/stripe/webhook",
          clone: () => new URL("https://motko.app/api/stripe/webhook"),
        },
        url: "https://motko.app/api/stripe/webhook",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer webhook-token",
        }),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // No redirect - public API route accessible
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("Cookie-based authentication still works", () => {
    it("allows access to authenticated routes with valid session cookie", async () => {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({
              data: { user: { id: "contractor-123", email: "test@example.com" } },
              error: null
            }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/dashboard",
          clone: () => new URL("https://motko.app/dashboard"),
        },
        url: "https://motko.app/dashboard",
        cookies: {
          getAll: () => [
            { name: "sb-access-token", value: "valid-session-cookie" }
          ],
          set: vi.fn()
        },
        headers: new Headers(),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // No redirect - valid session allows access
      expect(response.headers.get("location")).toBeNull();
    });

    it("redirects to /login when no session cookie and no bearer token", async () => {
      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: {
            getUser: vi.fn(async () => ({ data: { user: null }, error: null }))
          },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/settings",
          clone: () => new URL("https://motko.app/settings"),
        },
        url: "https://motko.app/settings",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers(),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // Should redirect - no authentication provided
      expect(response.headers.get("location")).toBe("https://motko.app/login");
    });
  });

  describe("Supabase client is only called with cookie-based auth", () => {
    it("calls getUser without a token parameter", async () => {
      const getUserMock = vi.fn(async () => ({ data: { user: null }, error: null }));

      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: { getUser: getUserMock },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/dashboard",
          clone: () => new URL("https://motko.app/dashboard"),
        },
        url: "https://motko.app/dashboard",
        cookies: {
          getAll: () => [],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer token-that-should-be-ignored",
        }),
      } as unknown as NextRequest;

      await updateSession(request);

      // getUser should be called with no arguments (cookie-based only)
      expect(getUserMock).toHaveBeenCalledWith();
      expect(getUserMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge case: both bearer token and session cookie present", () => {
    it("uses only the session cookie, ignoring the bearer token", async () => {
      const getUserMock = vi.fn(async () => ({
        data: { user: { id: "contractor-456", email: "cookie@example.com" } },
        error: null
      }));

      vi.doMock("@supabase/ssr", () => ({
        createServerClient: () => ({
          auth: { getUser: getUserMock },
        }),
      }));

      const { updateSession } = await import("@/lib/supabase/middleware");

      const request = {
        nextUrl: {
          pathname: "/jobs",
          clone: () => new URL("https://motko.app/jobs"),
        },
        url: "https://motko.app/jobs",
        cookies: {
          getAll: () => [
            { name: "sb-access-token", value: "valid-cookie-session" }
          ],
          set: vi.fn()
        },
        headers: new Headers({
          "Authorization": "Bearer different-bearer-token",
        }),
      } as unknown as NextRequest;

      const response = await updateSession(request);

      // Should succeed using cookie auth
      expect(response.headers.get("location")).toBeNull();

      // getUser called with no token argument (cookie-based only)
      expect(getUserMock).toHaveBeenCalledWith();
      expect(getUserMock).not.toHaveBeenCalledWith(expect.any(String));
    });
  });

  describe("No remnants of bearer token handling", () => {
    it("middleware module exists and exports updateSession", async () => {
      const mod = await import("@/lib/supabase/middleware");
      expect(mod.updateSession).toBeDefined();
      expect(typeof mod.updateSession).toBe("function");
    });

    it("PUBLIC_API_ROUTES is still exported for the no-blank-link invariant", async () => {
      const mod = await import("@/lib/supabase/middleware");
      expect(mod.PUBLIC_API_ROUTES).toBeDefined();
      expect(Array.isArray(mod.PUBLIC_API_ROUTES)).toBe(true);
    });
  });
});
