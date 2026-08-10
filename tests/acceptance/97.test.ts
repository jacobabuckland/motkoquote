import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Issue #97: Add rate limiting to create-payment, Companies House proxy, PDF routes and public actions
//
// These tests verify that rate limits are applied to the four exposed surfaces:
// 1. POST /api/truelayer/create-payment (per-IP and per-invoice)
// 2. GET /api/companies-house/search (per-IP)
// 3. GET /api/quotes/[id]/pdf and /api/contracts/[id]/pdf (per-IP and per-resource)
// 4. Public customer actions: acceptQuote, declineQuote, signContract, declineContract (per-IP and per-resource)
//
// Limits must:
// - Return 429 with Retry-After header when exceeded
// - Be configurable via environment variables
// - Support both per-IP and per-resource limits (logical AND)
// - Not block legitimate use (customer opening own quote 5 times in a minute)
// - Exclude authenticated service callers
// - Fail open (allow request) if backing store is unavailable

describe("Issue #97: Rate limiting", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to defaults for each test
    process.env.RATE_LIMIT_CREATE_PAYMENT_PER_IP = "10";
    process.env.RATE_LIMIT_CREATE_PAYMENT_WINDOW_IP = "60";
    process.env.RATE_LIMIT_CREATE_PAYMENT_PER_INVOICE = "5";
    process.env.RATE_LIMIT_CREATE_PAYMENT_WINDOW_INVOICE = "60";
    process.env.RATE_LIMIT_COMPANIES_HOUSE_PER_IP = "30";
    process.env.RATE_LIMIT_COMPANIES_HOUSE_WINDOW = "60";
    process.env.RATE_LIMIT_PDF_PER_IP = "20";
    process.env.RATE_LIMIT_PDF_WINDOW_IP = "60";
    process.env.RATE_LIMIT_PDF_PER_RESOURCE = "10";
    process.env.RATE_LIMIT_PDF_WINDOW_RESOURCE = "60";
    process.env.RATE_LIMIT_CUSTOMER_ACTION_PER_IP = "30";
    process.env.RATE_LIMIT_CUSTOMER_ACTION_WINDOW_IP = "60";
    process.env.RATE_LIMIT_CUSTOMER_ACTION_PER_RESOURCE = "5";
    process.env.RATE_LIMIT_CUSTOMER_ACTION_WINDOW_RESOURCE = "60";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("create-payment route", () => {
    it("allows requests under the per-IP limit", async () => {
      // Import dynamically to pick up env vars set in beforeEach
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ invoiceId: "inv-1" }),
      });

      // First request should succeed (or fail for reasons other than rate limiting)
      const res = await POST(req);
      expect(res.status).not.toBe(429);
    });

    it("returns 429 with Retry-After header when per-IP limit exceeded", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      // Make 11 requests from the same IP (limit is 10)
      for (let i = 0; i < 11; i++) {
        const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
          method: "POST",
          headers: {
            "x-forwarded-for": "203.0.113.2",
            "content-type": "application/json",
          },
          body: JSON.stringify({ invoiceId: `inv-${i}` }),
        });

        const res = await POST(req);

        if (i < 10) {
          // First 10 should not be rate limited
          expect(res.status).not.toBe(429);
        } else {
          // 11th should be rate limited
          expect(res.status).toBe(429);
          expect(res.headers.has("retry-after")).toBe(true);
          const retryAfter = parseInt(res.headers.get("retry-after") ?? "0", 10);
          expect(retryAfter).toBeGreaterThan(0);
          expect(retryAfter).toBeLessThanOrEqual(60);

          const body = await res.json();
          expect(body.error).toContain("Too many payment requests");
          expect(body.error).toContain("try again");
        }
      }
    });

    it("returns 429 with customer-readable message when per-invoice limit exceeded", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      // Make 6 requests for the same invoice from different IPs (limit is 5 per invoice)
      for (let i = 0; i < 6; i++) {
        const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
          method: "POST",
          headers: {
            "x-forwarded-for": `203.0.113.${10 + i}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ invoiceId: "inv-same" }),
        });

        const res = await POST(req);

        if (i < 5) {
          expect(res.status).not.toBe(429);
        } else {
          expect(res.status).toBe(429);
          expect(res.headers.has("retry-after")).toBe(true);

          const body = await res.json();
          expect(body.error).toMatch(/too many.*request/i);
          expect(typeof body.error).toBe("string");
          // Customer-readable, not developer jargon
          expect(body.error).not.toContain("rate limit");
        }
      }
    });

    it("excludes authenticated service callers from limits", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");
      process.env.CRON_SECRET = "test-secret";

      // Make more than the limit with a service credential
      for (let i = 0; i < 15; i++) {
        const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
          method: "POST",
          headers: {
            "x-forwarded-for": "203.0.113.100",
            "authorization": "Bearer test-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ invoiceId: `inv-service-${i}` }),
        });

        const res = await POST(req);
        // Should not be rate limited, though may fail for other reasons (missing TrueLayer config, etc.)
        expect(res.status).not.toBe(429);
      }
    });
  });

  describe("Companies House proxy route", () => {
    it("allows requests under the per-IP limit", async () => {
      const { GET } = await import("@/app/api/companies-house/search/route");

      const req = new NextRequest("https://motko.app/api/companies-house/search?q=test", {
        headers: { "x-forwarded-for": "203.0.113.20" },
      });

      const res = await GET(req);
      expect(res.status).not.toBe(429);
    });

    it("returns 429 with Retry-After header when per-IP limit exceeded", async () => {
      const { GET } = await import("@/app/api/companies-house/search/route");

      // Make 31 requests from the same IP (limit is 30)
      for (let i = 0; i < 31; i++) {
        const req = new NextRequest(`https://motko.app/api/companies-house/search?q=test${i}`, {
          headers: { "x-forwarded-for": "203.0.113.21" },
        });

        const res = await GET(req);

        if (i < 30) {
          expect(res.status).not.toBe(429);
        } else {
          expect(res.status).toBe(429);
          expect(res.headers.has("retry-after")).toBe(true);
          const retryAfter = parseInt(res.headers.get("retry-after") ?? "0", 10);
          expect(retryAfter).toBeGreaterThan(0);
        }
      }
    });

    it("per-IP limit accommodates shared corporate NAT (30 different users)", async () => {
      const { GET } = await import("@/app/api/companies-house/search/route");

      // 30 different users behind the same corporate NAT, each searching once
      for (let i = 0; i < 30; i++) {
        const req = new NextRequest(`https://motko.app/api/companies-house/search?q=company${i}`, {
          headers: { "x-forwarded-for": "203.0.113.50" }, // Same IP
        });

        const res = await GET(req);
        expect(res.status).not.toBe(429);
      }
    });
  });

  describe("PDF routes", () => {
    describe("quote PDF", () => {
      it("allows requests under both limits", async () => {
        const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

        const req = new NextRequest("https://motko.app/api/quotes/q-1/pdf", {
          headers: { "x-forwarded-for": "203.0.113.30" },
        });

        const res = await GET(req, { params: Promise.resolve({ id: "q-1" }) });
        expect(res.status).not.toBe(429);
      });

      it("returns 429 when per-IP limit exceeded", async () => {
        const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

        // 21 requests from same IP for different quotes (limit is 20)
        for (let i = 0; i < 21; i++) {
          const req = new NextRequest(`https://motko.app/api/quotes/q-${i}/pdf`, {
            headers: { "x-forwarded-for": "203.0.113.31" },
          });

          const res = await GET(req, { params: Promise.resolve({ id: `q-${i}` }) });

          if (i < 20) {
            expect(res.status).not.toBe(429);
          } else {
            expect(res.status).toBe(429);
            expect(res.headers.has("retry-after")).toBe(true);
          }
        }
      });

      it("returns 429 when per-resource limit exceeded", async () => {
        const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

        // 11 requests for same quote from different IPs (limit is 10 per resource)
        for (let i = 0; i < 11; i++) {
          const req = new NextRequest("https://motko.app/api/quotes/q-same/pdf", {
            headers: { "x-forwarded-for": `203.0.113.${40 + i}` },
          });

          const res = await GET(req, { params: Promise.resolve({ id: "q-same" }) });

          if (i < 10) {
            expect(res.status).not.toBe(429);
          } else {
            expect(res.status).toBe(429);
            expect(res.headers.has("retry-after")).toBe(true);
          }
        }
      });

      it("allows customer opening their own quote 5 times in a minute", async () => {
        const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

        // Customer refreshes 5 times (well under the 10/min per-resource limit)
        for (let i = 0; i < 5; i++) {
          const req = new NextRequest("https://motko.app/api/quotes/q-customer/pdf", {
            headers: { "x-forwarded-for": "203.0.113.60" },
          });

          const res = await GET(req, { params: Promise.resolve({ id: "q-customer" }) });
          expect(res.status).not.toBe(429);
        }
      });

      it("allows legitimate send fan-out (10 customers, same quote)", async () => {
        const { GET } = await import("@/app/api/quotes/[id]/pdf/route");

        // Contractor sends quote to 10 customers, all open it within a minute
        for (let i = 0; i < 10; i++) {
          const req = new NextRequest("https://motko.app/api/quotes/q-fanout/pdf", {
            headers: { "x-forwarded-for": `203.0.113.${70 + i}` }, // Different IPs
          });

          const res = await GET(req, { params: Promise.resolve({ id: "q-fanout" }) });
          expect(res.status).not.toBe(429);
        }
      });
    });

    describe("contract PDF", () => {
      it("applies same limits as quote PDF", async () => {
        const { GET } = await import("@/app/api/contracts/[id]/pdf/route");

        // 11 requests for same contract from different IPs (limit is 10 per resource)
        for (let i = 0; i < 11; i++) {
          const req = new NextRequest("https://motko.app/api/contracts/c-same/pdf", {
            headers: { "x-forwarded-for": `203.0.113.${80 + i}` },
          });

          const res = await GET(req, { params: Promise.resolve({ id: "c-same" }) });

          if (i < 10) {
            expect(res.status).not.toBe(429);
          } else {
            expect(res.status).toBe(429);
            expect(res.headers.has("retry-after")).toBe(true);
          }
        }
      });
    });
  });

  describe("public customer actions", () => {
    describe("acceptQuote action", () => {
      it("allows requests under both limits", async () => {
        // Note: Testing server actions requires mocking headers() from next/headers
        const { acceptQuote } = await import("@/app/q/[id]/actions");

        // Mock headers to return an IP
        vi.mock("next/headers", () => ({
          headers: () => ({
            get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.90" : null),
          }),
        }));

        // Should not throw a rate limit error
        await expect(acceptQuote("q-1")).resolves.not.toThrow();
      });

      it("throws rate limit error when per-IP limit exceeded", async () => {
        const { acceptQuote } = await import("@/app/q/[id]/actions");

        vi.mock("next/headers", () => ({
          headers: () => ({
            get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.91" : null),
          }),
        }));

        // 31 requests from same IP (limit is 30)
        for (let i = 0; i < 31; i++) {
          if (i < 30) {
            await expect(acceptQuote(`q-${i}`)).resolves.not.toThrow();
          } else {
            await expect(acceptQuote(`q-${i}`)).rejects.toThrow(/too many/i);
          }
        }
      });

      it("throws rate limit error when per-resource limit exceeded", async () => {
        const { acceptQuote } = await import("@/app/q/[id]/actions");

        // 6 requests for same quote from different IPs (limit is 5 per resource)
        for (let i = 0; i < 6; i++) {
          vi.mock("next/headers", () => ({
            headers: () => ({
              get: (name: string) => (name === "x-forwarded-for" ? `203.0.113.${100 + i}` : null),
            }),
          }));

          if (i < 5) {
            await expect(acceptQuote("q-action-same")).resolves.not.toThrow();
          } else {
            await expect(acceptQuote("q-action-same")).rejects.toThrow(/too many/i);
          }
        }
      });

      it("error message is customer-readable", async () => {
        const { acceptQuote } = await import("@/app/q/[id]/actions");

        vi.mock("next/headers", () => ({
          headers: () => ({
            get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.110" : null),
          }),
        }));

        // Exceed the limit
        for (let i = 0; i < 6; i++) {
          try {
            await acceptQuote("q-readable");
          } catch (err) {
            if (i === 5) {
              expect(err).toBeInstanceOf(Error);
              expect((err as Error).message).toMatch(/too many.*request/i);
              expect((err as Error).message).toMatch(/try again/i);
              // Should not contain developer jargon
              expect((err as Error).message).not.toContain("rate limit");
              expect((err as Error).message).not.toContain("429");
            }
          }
        }
      });
    });

    describe("signContract action", () => {
      it("applies same limits as acceptQuote", async () => {
        const { signContract } = await import("@/app/c/[id]/actions");

        vi.mock("next/headers", () => ({
          headers: () => ({
            get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.120" : null),
          }),
        }));

        // 6 requests for same contract from different IPs (limit is 5 per resource)
        for (let i = 0; i < 6; i++) {
          vi.mock("next/headers", () => ({
            headers: () => ({
              get: (name: string) => (name === "x-forwarded-for" ? `203.0.113.${120 + i}` : null),
            }),
          }));

          if (i < 5) {
            await expect(signContract("c-action-same", "Customer Name")).resolves.not.toThrow();
          } else {
            await expect(signContract("c-action-same", "Customer Name")).rejects.toThrow(/too many/i);
          }
        }
      });
    });
  });

  describe("configurability via environment variables", () => {
    it("respects custom per-IP limit from env", async () => {
      process.env.RATE_LIMIT_CREATE_PAYMENT_PER_IP = "2"; // Very low limit for testing
      process.env.RATE_LIMIT_CREATE_PAYMENT_WINDOW_IP = "60";

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      // 3 requests should hit the limit
      for (let i = 0; i < 3; i++) {
        const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
          method: "POST",
          headers: {
            "x-forwarded-for": "203.0.113.200",
            "content-type": "application/json",
          },
          body: JSON.stringify({ invoiceId: `inv-${i}` }),
        });

        const res = await POST(req);

        if (i < 2) {
          expect(res.status).not.toBe(429);
        } else {
          expect(res.status).toBe(429);
        }
      }
    });

    it("allows all requests when limit env var is unset", async () => {
      delete process.env.RATE_LIMIT_CREATE_PAYMENT_PER_IP;

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      // Many requests should all succeed (or fail for non-rate-limit reasons)
      for (let i = 0; i < 20; i++) {
        const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
          method: "POST",
          headers: {
            "x-forwarded-for": "203.0.113.210",
            "content-type": "application/json",
          },
          body: JSON.stringify({ invoiceId: `inv-${i}` }),
        });

        const res = await POST(req);
        expect(res.status).not.toBe(429);
      }
    });
  });

  describe("backing store failure", () => {
    it("fails open (allows request) when backing store is unavailable", async () => {
      // This test verifies that if the rate limiter can't reach its backing store,
      // it allows the request rather than blocking legitimate traffic.
      // Implementation note: the rate limiter should catch backing store errors
      // and return { allowed: true }, logging the failure.

      // Mock the rate limiter to simulate backing store failure
      vi.mock("@/lib/rate-limit", () => ({
        checkRateLimit: async () => {
          // Simulate backing store unavailable
          throw new Error("Backing store connection failed");
        },
      }));

      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.220",
          "content-type": "application/json",
        },
        body: JSON.stringify({ invoiceId: "inv-failopen" }),
      });

      const res = await POST(req);
      // Should not return 429, even though backing store is down
      expect(res.status).not.toBe(429);
      // May fail for other reasons (missing config, etc.), but not rate limiting
    });
  });

  describe("IP extraction", () => {
    it("extracts IP from x-forwarded-for header", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
        method: "POST",
        headers: {
          "x-forwarded-for": "198.51.100.1, 192.0.2.1", // Proxy chain
          "content-type": "application/json",
        },
        body: JSON.stringify({ invoiceId: "inv-xff" }),
      });

      // Should extract the first IP (leftmost, the client)
      const res = await POST(req);
      expect(res.status).not.toBe(429); // First request
    });

    it("falls back to x-real-ip if x-forwarded-for is missing", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
        method: "POST",
        headers: {
          "x-real-ip": "198.51.100.2",
          "content-type": "application/json",
        },
        body: JSON.stringify({ invoiceId: "inv-xri" }),
      });

      const res = await POST(req);
      expect(res.status).not.toBe(429); // First request
    });

    it("allows request if IP cannot be determined (fail open)", async () => {
      const { POST } = await import("@/app/api/truelayer/create-payment/route");

      const req = new NextRequest("https://motko.app/api/truelayer/create-payment", {
        method: "POST",
        headers: {
          // No IP headers at all
          "content-type": "application/json",
        },
        body: JSON.stringify({ invoiceId: "inv-noip" }),
      });

      // Should allow the request (per-resource limit still applies, but per-IP is skipped)
      const res = await POST(req);
      expect(res.status).not.toBe(429);
    });
  });
});
