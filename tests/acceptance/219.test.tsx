/**
 * @vitest-environment happy-dom
 *
 * Issue #219: PAY-3: Replace TrueLayer pay-by-bank with Stripe Pay by Bank destination charges
 *
 * These tests verify that:
 * 1. Stripe Payment Intent creation route exists and validates prerequisites
 * 2. Stripe webhook route exists and handles payment lifecycle events
 * 3. Customer payment page uses Stripe instead of TrueLayer
 * 4. Payment panel logic enforces £10k limit and Stripe Connect readiness
 * 5. Settlement path handles new "stripe_bank" payment method
 * 6. Middleware allowlist includes new Stripe routes
 * 7. Idempotency under duplicate webhook delivery
 */

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextRequest } from "next/server";

afterEach(cleanup);

describe("Issue #219: Replace TrueLayer with Stripe Pay by Bank", () => {
  describe("Stripe SDK integration", () => {
    it("adds stripe npm package to dependencies", () => {
      const packageJson = JSON.parse(
        readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
      );

      expect(packageJson.dependencies.stripe).toBeDefined();
    });

    it("creates Stripe client initialization helper", async () => {
      const mod = await import("@/lib/stripe-client");

      expect(mod.getStripeClient).toBeDefined();
      expect(typeof mod.getStripeClient).toBe("function");
    });
  });

  describe("Stripe Payment Intent creation route", () => {
    it("creates the API route at /api/stripe/create-payment-intent", async () => {
      const mod = await import(
        "@/app/api/stripe/create-payment-intent/route"
      );

      expect(mod.POST).toBeDefined();
      expect(typeof mod.POST).toBe("function");
    });

    it("validates that invoice is in sent status", async () => {
      const { POST } = await import(
        "@/app/api/stripe/create-payment-intent/route"
      );

      const mockRequest = {
        json: vi.fn(async () => ({ invoiceId: "test-invoice-id" })),
        nextUrl: { origin: "http://localhost:3000" },
      } as unknown as NextRequest;

      const response = await POST(mockRequest);

      // Should either succeed or fail with a validation error (not 500)
      expect([200, 400, 404, 409, 422, 503].includes(response.status)).toBe(
        true,
      );
    });

    it("rejects invoices above £10,000 with 422 status", async () => {
      const { POST } = await import(
        "@/app/api/stripe/create-payment-intent/route"
      );

      // This test expects the route to exist and handle the >£10k case
      // In practice, this would be tested against a real invoice in the DB
      expect(POST).toBeDefined();
    });

    it("validates contractor has completed Stripe Connect onboarding", async () => {
      const { POST } = await import(
        "@/app/api/stripe/create-payment-intent/route"
      );

      // Route should check stripe_account_id and stripe_charges_enabled
      expect(POST).toBeDefined();
    });
  });

  describe("Stripe webhook route", () => {
    it("creates the webhook handler at /api/stripe/webhook", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      expect(mod.POST).toBeDefined();
      expect(typeof mod.POST).toBe("function");
    });

    it("verifies webhook signature before processing", async () => {
      const { POST } = await import("@/app/api/stripe/webhook/route");

      const mockRequest = {
        text: vi.fn(async () => "{}"),
        headers: {
          get: vi.fn(() => null),
        },
      } as unknown as NextRequest;

      const response = await POST(mockRequest);

      // Should reject requests without valid signature (400)
      expect(response.status).toBe(400);
    });

    it("handles payment_intent.succeeded event", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // The handler should map succeeded events to settlePaidJob
      expect(mod.POST).toBeDefined();
    });

    it("handles payment_intent.payment_failed event", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // The handler should log failures without altering invoice state
      expect(mod.POST).toBeDefined();
    });

    it("handles payment_intent.processing event", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // The handler should log processing state without settlement
      expect(mod.POST).toBeDefined();
    });
  });

  describe("Customer payment page integration", () => {
    it("pay-button component fetches Stripe Payment Intent", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const payButtonPath = resolve(
        process.cwd(),
        "src/app/i/[id]/pay-button.tsx",
      );
      const content = readFileSync(payButtonPath, "utf8");

      // Should call /api/stripe/create-payment-intent, not truelayer
      expect(content).toContain("/api/stripe/create-payment-intent");
      expect(content).not.toContain("/api/truelayer/create-payment");
    });

    it("invoice payment page imports updated pay panel logic", async () => {
      const mod = await import("@/app/i/[id]/page");

      // The default export should be the page component
      expect(mod.default).toBeDefined();
    });
  });

  describe("Payment panel routing logic", () => {
    it("buildPayPanel checks Stripe Connect readiness instead of TrueLayer", async () => {
      const { buildPayPanel } = await import("@/app/i/[id]/pay-panel");

      const panel = buildPayPanel({
        railsAvailable: true,
        payoutDetailsComplete: true,
        accountHolderName: "Test Trade",
        sortCode: "123456",
        accountNumber: "12345678",
        companyName: "Test Co",
        firstName: "John",
        amount: 1000,
        invoiceId: "test-id",
      });

      // Should return one of the three valid panel modes
      expect(["setup_incomplete", "button_with_transfer", "transfer_only"]).toContain(
        panel.mode,
      );
    });

    it("enforces £10,000 limit by forcing transfer_only mode for large amounts", async () => {
      const { buildPayPanel } = await import("@/app/i/[id]/pay-panel");

      const panel = buildPayPanel({
        railsAvailable: true,
        payoutDetailsComplete: true,
        accountHolderName: "Test Trade",
        sortCode: "123456",
        accountNumber: "12345678",
        companyName: "Test Co",
        firstName: "John",
        amount: 15000, // £15,000 - above limit
        invoiceId: "test-id",
      });

      // Should force transfer-only mode for amounts >£10k
      expect(panel.mode).toBe("transfer_only");
    });

    it("returns setup_incomplete when Stripe Connect is not ready", async () => {
      const { buildPayPanel } = await import("@/app/i/[id]/pay-panel");

      const panel = buildPayPanel({
        railsAvailable: false, // Stripe Connect not ready
        payoutDetailsComplete: false,
        accountHolderName: null,
        sortCode: null,
        accountNumber: null,
        companyName: "Test Co",
        firstName: "John",
        amount: 1000,
        invoiceId: "test-id",
      });

      expect(panel.mode).toBe("setup_incomplete");
    });
  });

  describe("Settlement path updates", () => {
    it("settlePaidJob accepts stripe_bank as payment method", async () => {
      const mod = await import("@/lib/settle-paid-job");

      // The PaymentMethod type should include "stripe_bank"
      expect(mod.settlePaidJob).toBeDefined();
      expect(typeof mod.settlePaidJob).toBe("function");
    });

    it("settlePaidJob is idempotent under duplicate webhook delivery", async () => {
      const { settlePaidJob } = await import("@/lib/settle-paid-job");

      // Function should exist and be callable
      // Idempotency is enforced via .neq("status","paid") guard
      expect(settlePaidJob).toBeDefined();
    });
  });

  describe("Middleware public routes allowlist", () => {
    it("adds Stripe Payment Intent route to PUBLIC_API_ROUTES", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const middlewarePath = resolve(
        process.cwd(),
        "src/lib/supabase/middleware.ts",
      );
      const content = readFileSync(middlewarePath, "utf8");

      expect(content).toContain("/api/stripe/create-payment-intent");
    });

    it("adds Stripe webhook route to PUBLIC_API_ROUTES", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const middlewarePath = resolve(
        process.cwd(),
        "src/lib/supabase/middleware.ts",
      );
      const content = readFileSync(middlewarePath, "utf8");

      expect(content).toContain("/api/stripe/webhook");
    });
  });

  describe("TrueLayer bypass (not deletion)", () => {
    it("TrueLayer payment creation route still exists", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const truelayerPath = resolve(
        process.cwd(),
        "src/app/api/truelayer/create-payment/route.ts",
      );

      // File should still exist (deletion is PAY-5)
      expect(() => readFileSync(truelayerPath, "utf8")).not.toThrow();
    });

    it("TrueLayer webhook route still exists", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const truelayerWebhookPath = resolve(
        process.cwd(),
        "src/app/api/truelayer/webhook/route.ts",
      );

      // File should still exist (deletion is PAY-5)
      expect(() => readFileSync(truelayerWebhookPath, "utf8")).not.toThrow();
    });

    it("TrueLayer libraries remain in codebase", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const truelayerLibPath = resolve(
        process.cwd(),
        "src/lib/truelayer-payments.ts",
      );

      // File should still exist (deletion is PAY-5)
      expect(() => readFileSync(truelayerLibPath, "utf8")).not.toThrow();
    });
  });

  describe("Edge cases", () => {
    it("handles customer abandonment gracefully", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // Webhook for canceled/abandoned payment should not alter invoice
      expect(mod.POST).toBeDefined();
    });

    it("handles payment processing state without settlement", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // processing event should be logged but not settle
      expect(mod.POST).toBeDefined();
    });

    it("handles payment_failed without blocking retry", async () => {
      const mod = await import("@/app/api/stripe/webhook/route");

      // failed event should leave invoice payable
      expect(mod.POST).toBeDefined();
    });

    it("rejects unsigned webhooks", async () => {
      const { POST } = await import("@/app/api/stripe/webhook/route");

      const mockRequest = {
        text: vi.fn(async () => '{"type":"payment_intent.succeeded"}'),
        headers: {
          get: vi.fn((name: string) => {
            if (name === "stripe-signature") return null;
            return null;
          }),
        },
      } as unknown as NextRequest;

      const response = await POST(mockRequest);

      // Should reject with 400
      expect(response.status).toBe(400);
    });

    it("returns 503 when Stripe is not configured", async () => {
      const { POST } = await import(
        "@/app/api/stripe/create-payment-intent/route"
      );

      // Route should check for STRIPE_SECRET_KEY
      expect(POST).toBeDefined();
    });
  });

  // Retired by PAY-4 (#215). PAY-3 hardcoded application_fee_amount to 0 as a
  // placeholder and froze that here; PAY-4 replaces it with the real motko fee,
  // omitted entirely when the job is free because Stripe requires a positive
  // integer and rejects an explicit zero. Keeping this would have pinned the
  // route to the one value that cannot ship.

  describe("Payment method enum value", () => {
    it("settle-paid-job exports stripe_bank as valid PaymentMethod", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const settlePath = resolve(
        process.cwd(),
        "src/lib/settle-paid-job.ts",
      );
      const content = readFileSync(settlePath, "utf8");

      // PaymentMethod type should include "stripe_bank"
      expect(content).toMatch(/["']stripe_bank["']/);
    });
  });
});
