/**
 * @vitest-environment happy-dom
 *
 * Issue #145: Add loading skeletons to the customer-facing routes
 *
 * These tests verify that each customer-facing route (quote, invoice, contract)
 * has a loading skeleton that renders immediately without data fetching, matches
 * the resolved page structure, and contains no text content.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Required. The vitest config does not set `globals: true`, so Testing
// Library's automatic cleanup never registers itself.
afterEach(cleanup);

describe("Issue #145: Loading skeletons for customer-facing routes", () => {
  describe("Quote view loading skeleton (q/[id]/loading.tsx)", () => {
    it("exists and can be imported", async () => {
      // This will fail with a module resolution error until the file is created
      const mod = await import("@/app/q/[id]/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("renders without errors", async () => {
      const Loading = (await import("@/app/q/[id]/loading")).default;
      expect(() => render(<Loading />)).not.toThrow();
    });

    it("contains skeleton elements", async () => {
      const Loading = (await import("@/app/q/[id]/loading")).default;
      const { container } = render(<Loading />);

      // Skeleton components render as divs with animate-pulse and bg-stone-200
      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("contains no text content", async () => {
      const Loading = (await import("@/app/q/[id]/loading")).default;
      const { container } = render(<Loading />);

      // The skeleton should have no visible text (empty or whitespace only)
      const text = container.textContent?.trim() || "";
      expect(text).toBe("");
    });

    it("matches the quote page structure with header and card layout", async () => {
      const Loading = (await import("@/app/q/[id]/loading")).default;
      const { container } = render(<Loading />);

      // Quote page has: main > div > (header area) + card + totals + actions
      // We verify structural elements exist without being too prescriptive
      const main = container.querySelector("main");
      expect(main).toBeTruthy();

      const skeletons = container.querySelectorAll(".animate-pulse");
      // Header area (logo + company name + customer), card with line items,
      // totals section, and action area = expect at least 8-10 skeleton elements
      expect(skeletons.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("Invoice pay loading skeleton (i/[id]/loading.tsx)", () => {
    it("exists and can be imported", async () => {
      const mod = await import("@/app/i/[id]/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("renders without errors", async () => {
      const Loading = (await import("@/app/i/[id]/loading")).default;
      expect(() => render(<Loading />)).not.toThrow();
    });

    it("contains skeleton elements", async () => {
      const Loading = (await import("@/app/i/[id]/loading")).default;
      const { container } = render(<Loading />);

      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("contains no text content", async () => {
      const Loading = (await import("@/app/i/[id]/loading")).default;
      const { container } = render(<Loading />);

      const text = container.textContent?.trim() || "";
      expect(text).toBe("");
    });

    it("matches the invoice page structure with header and card layout", async () => {
      const Loading = (await import("@/app/i/[id]/loading")).default;
      const { container } = render(<Loading />);

      const main = container.querySelector("main");
      expect(main).toBeTruthy();

      const skeletons = container.querySelectorAll(".animate-pulse");
      // Header area (logo + company name + customer), card with amount,
      // payment UI area = expect at least 4-6 skeleton elements
      expect(skeletons.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Contract view loading skeleton (c/[id]/loading.tsx)", () => {
    it("exists and can be imported", async () => {
      const mod = await import("@/app/c/[id]/loading");
      expect(mod.default).toBeDefined();
      expect(typeof mod.default).toBe("function");
    });

    it("renders without errors", async () => {
      const Loading = (await import("@/app/c/[id]/loading")).default;
      expect(() => render(<Loading />)).not.toThrow();
    });

    it("contains skeleton elements", async () => {
      const Loading = (await import("@/app/c/[id]/loading")).default;
      const { container } = render(<Loading />);

      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("contains no text content", async () => {
      const Loading = (await import("@/app/c/[id]/loading")).default;
      const { container } = render(<Loading />);

      const text = container.textContent?.trim() || "";
      expect(text).toBe("");
    });

    it("matches the contract page structure with header and card layout", async () => {
      const Loading = (await import("@/app/c/[id]/loading")).default;
      const { container } = render(<Loading />);

      const main = container.querySelector("main");
      expect(main).toBeTruthy();

      const skeletons = container.querySelectorAll(".animate-pulse");
      // Header area (logo + company name + customer), card with values,
      // contract body area, action area = expect at least 6-8 skeleton elements
      expect(skeletons.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe("Cross-cutting requirements", () => {
    it("all three loading skeletons use the Skeleton component", async () => {
      const QuoteLoading = (await import("@/app/q/[id]/loading")).default;
      const InvoiceLoading = (await import("@/app/i/[id]/loading")).default;
      const ContractLoading = (await import("@/app/c/[id]/loading")).default;

      const quoteContainer = render(<QuoteLoading />).container;
      const invoiceContainer = render(<InvoiceLoading />).container;
      const contractContainer = render(<ContractLoading />).container;

      // All should have the Skeleton component's characteristic classes
      expect(quoteContainer.querySelectorAll(".animate-pulse.bg-stone-200").length).toBeGreaterThan(0);
      expect(invoiceContainer.querySelectorAll(".animate-pulse.bg-stone-200").length).toBeGreaterThan(0);
      expect(contractContainer.querySelectorAll(".animate-pulse.bg-stone-200").length).toBeGreaterThan(0);
    });

    it("skeletons render synchronously without async data fetching", async () => {
      // Loading components must be synchronous — they cannot be async functions
      // or contain top-level await, as that would defeat the purpose of immediate rendering
      const QuoteLoading = (await import("@/app/q/[id]/loading")).default;
      const InvoiceLoading = (await import("@/app/i/[id]/loading")).default;
      const ContractLoading = (await import("@/app/c/[id]/loading")).default;

      // If these render without throwing, they are synchronous
      // (async components would fail in this test environment)
      expect(() => render(<QuoteLoading />)).not.toThrow();
      expect(() => render(<InvoiceLoading />)).not.toThrow();
      expect(() => render(<ContractLoading />)).not.toThrow();
    });
  });
});
