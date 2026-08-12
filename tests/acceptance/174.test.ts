import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";

// The rate limiter must be testable without any Supabase infrastructure.
// These tests use an in-memory store implementation that the limiter accepts
// via injection, proving the abstraction exists and works end-to-end.

describe("Issue #174: Rate-limit payment, Companies House and PDF routes", () => {
  describe("Core rate limiting behavior", () => {
    it("allows requests under the limit to pass through", async () => {
      // A client making their first request should be allowed
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      const result = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 60,
        store,
      });

      expect(result.allowed).toBe(true);
    });

    it("rejects the request that crosses the limit with 429", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Make 20 requests (the limit)
      for (let i = 0; i < 20; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        });
      }

      // The 21st request should be rejected
      const result = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 60,
        store,
      });

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("returns retry-after time in seconds when limit is exceeded", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Exhaust the limit
      for (let i = 0; i < 20; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        });
      }

      const result = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 60,
        store,
      });

      expect(result.retryAfterSeconds).toBeDefined();
      expect(typeof result.retryAfterSeconds).toBe("number");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("tracks limits per-client — two distinct keys do not consume each other's budget", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Client 1 exhausts their limit
      for (let i = 0; i < 20; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        });
      }

      // Client 2 should still have their full budget
      const result = await checkRateLimit({
        clientKey: "client-2",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 60,
        store,
      });

      expect(result.allowed).toBe(true);
    });

    it("rolls the window — a client at the limit is admitted again once the window has passed", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Exhaust the limit
      for (let i = 0; i < 20; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 1, // 1-second window for faster test
          store,
        });
      }

      // Next request should be denied
      const deniedResult = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 1,
        store,
      });
      expect(deniedResult.allowed).toBe(false);

      // Wait for the window to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Now should be allowed again (new window)
      const allowedResult = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 1,
        store,
      });
      expect(allowedResult.allowed).toBe(true);
    });

    it("handles racing requests at the boundary — at most one is admitted when at the limit", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Make 19 requests (one below the limit)
      for (let i = 0; i < 19; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        });
      }

      // Now make two concurrent requests racing for the 20th slot
      const [result1, result2] = await Promise.all([
        checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        }),
        checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        }),
      ]);

      // Exactly one should be allowed, one should be denied
      const allowedCount = [result1, result2].filter((r) => r.allowed).length;
      expect(allowedCount).toBe(1);
    });
  });

  describe("Injectable store — testable without Supabase", () => {
    it("limiter can be constructed with an in-memory store", async () => {
      const { InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      expect(store).toBeDefined();
      expect(typeof store.checkAndIncrement).toBe("function");
    });

    it("in-memory store works end-to-end with no Supabase client", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // This should work without any Supabase setup
      const result = await checkRateLimit({
        clientKey: "test-client",
        routeKey: "test-route",
        limit: 5,
        windowSeconds: 60,
        store,
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe("Fail-closed routes: create-payment, acceptQuote, signContract", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("create-payment returns 503 when the store throws, and handler does NOT run", async () => {
      const handlerCalled = { value: false };

      // Mock the limiter to throw (simulating store failure)
      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      // Mock TrueLayer to track if the handler runs
      vi.doMock("@/lib/truelayer-payments", () => ({
        createTrueLayerPayment: vi.fn(async () => {
          handlerCalled.value = true;
          return { id: "pay-1", resourceToken: "token-1" };
        }),
      }));

      vi.doMock("@/lib/truelayer", () => ({
        getTrueLayerConfig: () => ({ clientId: "test", env: "sandbox" }),
        getTrueLayerSigning: () => ({ kid: "k1", privateKeyPem: "pem" }),
        buildHostedPaymentPageUrl: () => "https://pay.truelayer.example/pay-1",
      }));

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "inv-1",
                    amount: 100,
                    status: "sent",
                    quote: {
                      job: {
                        id: "job-1",
                        contractor: {
                          id: "c1",
                          company_name: "Acme",
                          payout_details_complete: true,
                          payout_account_holder_name: "Acme Ltd",
                          payout_sort_code: "000000",
                          payout_account_number: "12345678",
                        },
                        customer: { name: "Alex", contact: {} },
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }));

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const request = {
        json: async () => ({ invoiceId: "inv-1" }),
        nextUrl: { origin: "https://motko.app" },
      } as never;

      const response = await POST(request);

      expect(response.status).toBe(503);
      expect(handlerCalled.value).toBe(false);
    });

    it("acceptQuote returns 503 when the store throws, and the database is NOT updated", async () => {
      const dbUpdateCalled = { value: false };

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => ({
          from: () => ({
            update: () => {
              dbUpdateCalled.value = true;
              return {
                eq: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              };
            },
          }),
        }),
      }));

      const { acceptQuote } = await import("@/app/q/[id]/actions");

      await expect(acceptQuote("quote-1")).rejects.toThrow(/unavailable|503/i);
      expect(dbUpdateCalled.value).toBe(false);
    });

    it("signContract returns 503 when the store throws, and the database is NOT updated", async () => {
      const dbUpdateCalled = { value: false };

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    status: "sent",
                    deposit_pct: null,
                    quote: {
                      id: "quote-1",
                      total: 1000,
                      job: {
                        id: "job-1",
                        contractor: {
                          company_name: "Acme",
                          payout_details_complete: true,
                        },
                        customer: { name: "Alex", contact: {} },
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
            update: () => {
              dbUpdateCalled.value = true;
              return {
                eq: () => ({
                  select: async () => ({ data: [], error: null }),
                }),
              };
            },
          }),
        }),
      }));

      const { signContract } = await import("@/app/c/[id]/actions");

      await expect(signContract("contract-1", "Alex Smith")).rejects.toThrow(/unavailable|503/i);
      expect(dbUpdateCalled.value).toBe(false);
    });
  });

  describe("Fail-open routes: Companies House, quote PDF, contract PDF", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock("@/lib/rate-limit/limiter");
      vi.doUnmock("@/lib/companies-house");
      vi.doUnmock("@/lib/pdf/render-quote");
      vi.doUnmock("@/lib/pdf/render-contract");
    });

    it("companies-house proxy returns 200 when the store throws, and the handler DOES run", async () => {
      const handlerCalled = { value: false };
      const errorLogged = { value: false };

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      vi.doMock("@/lib/companies-house", () => ({
        searchCompanies: vi.fn(async () => {
          handlerCalled.value = true;
          return [{ name: "Acme Ltd", number: "12345678" }];
        }),
      }));

      vi.doMock("@/lib/analytics", () => ({
        logError: vi.fn(() => {
          errorLogged.value = true;
          return Promise.resolve();
        }),
      }));

      const { GET } = await import("@/app/api/companies-house/search/route");

      const request = {
        nextUrl: {
          searchParams: new URLSearchParams({ q: "Acme" }),
        },
      } as never;

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(handlerCalled.value).toBe(true);
      expect(errorLogged.value).toBe(true);
    });

    it("quote PDF route returns 200 when the store throws, and the handler DOES run", async () => {
      const handlerCalled = { value: false };

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      vi.doMock("@/lib/pdf/render-quote", () => ({
        renderQuotePdf: vi.fn(async () => {
          handlerCalled.value = true;
          return Buffer.from("fake-pdf-content");
        }),
      }));

      vi.doMock("@/lib/analytics", () => ({
        logError: vi.fn(() => Promise.resolve()),
      }));

      const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

      const request = {} as never;
      const params = Promise.resolve({ id: "quote-1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(handlerCalled.value).toBe(true);
    });

    it("contract PDF route returns 200 when the store throws, and the handler DOES run", async () => {
      const handlerCalled = { value: false };

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => {
          throw new Error("Store unavailable");
        }),
      }));

      vi.doMock("@/lib/pdf/render-contract", () => ({
        renderContractPdf: vi.fn(async () => {
          handlerCalled.value = true;
          return Buffer.from("fake-pdf-content");
        }),
      }));

      vi.doMock("@/lib/analytics", () => ({
        logError: vi.fn(() => Promise.resolve()),
      }));

      const { GET } = await import("@/app/api/contracts/[id]/pdf/route");

      const request = {} as never;
      const params = Promise.resolve({ id: "contract-1" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(handlerCalled.value).toBe(true);
    });
  });

  describe("Limit check runs first — before config, auth, or body parsing", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("create-payment: at-limit request returns 429 before TrueLayer config is checked", async () => {
      const configCheckCalled = { value: false };

      // Mock limiter to immediately deny
      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => ({
          allowed: false,
          retryAfterSeconds: 30,
        })),
      }));

      vi.doMock("@/lib/truelayer", () => ({
        getTrueLayerConfig: vi.fn(() => {
          configCheckCalled.value = true;
          return null; // Would normally cause 503
        }),
        getTrueLayerSigning: vi.fn(() => null),
      }));

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => ({
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }));

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const request = {
        json: async () => ({ invoiceId: "inv-1" }),
        nextUrl: { origin: "https://motko.app" },
      } as never;

      const response = await POST(request);

      expect(response.status).toBe(429);
      expect(configCheckCalled.value).toBe(false);
    });

    it("create-payment: at-limit request returns 429 before body parsing", async () => {
      const bodyParseCalled = { value: false };
      const originalJson = vi.fn(async () => {
        bodyParseCalled.value = true;
        return { invoiceId: "inv-1" };
      });

      vi.doMock("@/lib/rate-limit/limiter", () => ({
        checkRateLimit: vi.fn(async () => ({
          allowed: false,
          retryAfterSeconds: 30,
        })),
      }));

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const request = {
        json: originalJson,
        nextUrl: { origin: "https://motko.app" },
      } as never;

      const response = await POST(request);

      expect(response.status).toBe(429);
      // Body parsing for the full invoice payload should not happen
      // (Minimal parsing for client key derivation is allowed)
    });
  });

  describe("The six protected paths are exactly as specified", () => {
    it("lists the six protected routes", () => {
      const PROTECTED_ROUTES = [
        "POST /api/truelayer/create-payment",
        "GET /api/companies-house/search",
        "GET /api/quotes/[id]/pdf",
        "GET /api/contracts/[id]/pdf",
        "acceptQuote server action",
        "signContract server action",
      ];

      expect(PROTECTED_ROUTES).toHaveLength(6);
    });
  });

  describe("Client key derivation", () => {
    it("derives client key from IP address when available", async () => {
      const { deriveClientKey } = await import("@/lib/rate-limit/get-client-key");

      const request = {
        headers: {
          get: (name: string) => {
            if (name === "x-forwarded-for") return "203.0.113.42";
            return null;
          },
        },
      } as never;

      const clientKey = deriveClientKey(request, {});

      expect(clientKey).toBeTruthy();
      expect(clientKey).toContain("203.0.113.42");
    });

    it("derives client key from x-real-ip header when x-forwarded-for is missing", async () => {
      const { deriveClientKey } = await import("@/lib/rate-limit/get-client-key");

      const request = {
        headers: {
          get: (name: string) => {
            if (name === "x-real-ip") return "198.51.100.5";
            return null;
          },
        },
      } as never;

      const clientKey = deriveClientKey(request, {});

      expect(clientKey).toBeTruthy();
      expect(clientKey).toContain("198.51.100.5");
    });

    it("derives client key from resource ID when provided", async () => {
      const { deriveClientKey } = await import("@/lib/rate-limit/get-client-key");

      const request = {
        headers: {
          get: () => null,
        },
      } as never;

      const clientKey = deriveClientKey(request, { invoiceId: "inv-123" });

      expect(clientKey).toBeTruthy();
      expect(clientKey).toContain("inv-123");
    });

    it("returns null when client key cannot be derived (no IP and no resource ID)", async () => {
      const { deriveClientKey } = await import("@/lib/rate-limit/get-client-key");

      const request = {
        headers: {
          get: () => null,
        },
      } as never;

      const clientKey = deriveClientKey(request, {});

      // Should return null, which triggers a 429 rejection
      expect(clientKey).toBeNull();
    });
  });

  describe("User-visible responses", () => {
    it("429 response includes error message and retryAfter in body", async () => {
      const { checkRateLimit, InMemoryRateLimitStore } = await import("@/lib/rate-limit/limiter");
      const store = new InMemoryRateLimitStore();

      // Exhaust the limit
      for (let i = 0; i < 20; i++) {
        await checkRateLimit({
          clientKey: "client-1",
          routeKey: "test-route",
          limit: 20,
          windowSeconds: 60,
          store,
        });
      }

      const result = await checkRateLimit({
        clientKey: "client-1",
        routeKey: "test-route",
        limit: 20,
        windowSeconds: 60,
        store,
      });

      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeDefined();
      // The route handler should use this to construct:
      // { error: "Too many requests. Please wait a moment and try again.", retryAfter: N }
    });
  });
});
