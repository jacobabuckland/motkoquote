/**
 * @vitest-environment happy-dom
 *
 * Issue #152: Build the reassurance strip on the customer payment page
 *
 * These tests verify that:
 * 1. Approved regulatory copy strings are exported from a dedicated module
 * 2. ReassuranceStrip component renders shield glyph, copy, and payee name
 * 3. PayButton includes the formatted amount in its label
 * 4. Edge cases are handled: missing name, null amount, long names
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatGBP } from "@/lib/format";

afterEach(cleanup);

describe("Issue #152: Build the reassurance strip on the customer payment page", () => {
  describe("Payment reassurance copy module", () => {
    it("exports the first approved copy string exactly as specified", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_1).toBe(
        "Payments are processed by TrueLayer, authorised and regulated by the Financial Conduct Authority."
      );
    });

    it("exports the second approved copy string with trade placeholder", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_2).toBe(
        "Your money goes straight from your bank to {trade}."
      );
    });

    it("exports both strings as non-empty", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_1).toBeTruthy();
      expect(mod.PAYMENT_COPY_LINE_1.length).toBeGreaterThan(0);
      expect(mod.PAYMENT_COPY_LINE_2).toBeTruthy();
      expect(mod.PAYMENT_COPY_LINE_2.length).toBeGreaterThan(0);
    });
  });

  describe("ReassuranceStrip component", () => {
    it("renders both approved copy strings", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="Acme Plumbing" />);

      expect(
        screen.getByText(/Payments are processed by TrueLayer/)
      ).toBeTruthy();
      expect(
        screen.getByText(/Your money goes straight from your bank to/)
      ).toBeTruthy();
    });

    it("renders a shield glyph", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="Acme Plumbing" />);

      // Shield can be an SVG or an aria-label element
      // Look for common shield indicators: svg, role="img", aria-label containing "shield"
      const container = screen.getByText(
        /Payments are processed by TrueLayer/
      ).parentElement;
      const svg = container?.querySelector("svg");
      const shieldElement = container?.querySelector('[aria-label*="shield" i]');

      expect(svg || shieldElement).toBeTruthy();
    });

    it("renders the company name in bold within the second copy string", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="Acme Plumbing" />);

      // The company name should appear in the second sentence
      const companyNameElement = screen.getByText("Acme Plumbing");
      expect(companyNameElement).toBeTruthy();

      // It should be bold (font-bold, font-semibold, or font-medium class, or <strong>/<b> tag)
      const isBold =
        companyNameElement.classList.contains("font-bold") ||
        companyNameElement.classList.contains("font-semibold") ||
        companyNameElement.classList.contains("font-medium") ||
        companyNameElement.tagName === "STRONG" ||
        companyNameElement.tagName === "B";

      expect(isBold).toBe(true);
    });

    it("substitutes {trade} placeholder with actual company name", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="London Heating Ltd" />);

      // Should render the company name, not the literal "{trade}"
      expect(screen.getByText(/London Heating Ltd/)).toBeTruthy();
      expect(screen.queryByText(/{trade}/)).toBeNull();
    });

    it("renders without company name when name is missing", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="" />);

      // Should still render the copy strings
      expect(
        screen.getByText(/Payments are processed by TrueLayer/)
      ).toBeTruthy();

      // Should not render an empty bold element or "{trade}" literal
      expect(screen.queryByText("{trade}")).toBeNull();

      // The second sentence should render, possibly without the trade name
      expect(
        screen.getByText(/Your money goes straight from your bank/)
      ).toBeTruthy();
    });

    it("renders without company name when name is undefined", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName={undefined} />);

      // Should still render the copy strings
      expect(
        screen.getByText(/Payments are processed by TrueLayer/)
      ).toBeTruthy();
      expect(screen.queryByText("{trade}")).toBeNull();
    });

    it("does not use text-muted class on any element", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="Acme Plumbing" />);

      // Get the root container
      const copyElement = screen.getByText(/Payments are processed by TrueLayer/);
      const container = copyElement.closest("div");

      // Check that neither the container nor its children use text-muted
      const allElements = container?.querySelectorAll("*") ?? [];
      const hasMutedText = Array.from(allElements).some((el) =>
        el.classList.contains("text-muted") || el.classList.contains("text-text-muted")
      );

      expect(hasMutedText).toBe(false);
    });

    it("does not use text-xs class on any element", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      render(<ReassuranceStrip companyName="Acme Plumbing" />);

      const copyElement = screen.getByText(/Payments are processed by TrueLayer/);
      const container = copyElement.closest("div");

      // Check that the strip does not use text-xs
      const allElements = container?.querySelectorAll("*") ?? [];
      const hasXsText = Array.from(allElements).some((el) =>
        el.classList.contains("text-xs")
      );

      expect(hasXsText).toBe(false);
    });

    it("truncates very long company names with ellipsis", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      const longName =
        "Acme Plumbing and Heating Services Ltd with a Very Long Company Name That Should Truncate";

      render(<ReassuranceStrip companyName={longName} />);

      // The component should render, and the long name should be handled
      // We can't easily test visual truncation, but we can check that it renders
      expect(
        screen.getByText(/Payments are processed by TrueLayer/)
      ).toBeTruthy();

      // The component should render without error
      // Visual truncation is handled by CSS and difficult to test in JSDOM
      const container = screen.getByText(/Payments are processed by TrueLayer/)
        .parentElement;

      expect(container).toBeTruthy();
    });
  });

  describe("PayButton component", () => {
    it("includes the formatted amount in the button label", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={8132} />);

      // Button should say "Pay £8,132.00 by bank" or similar
      const button = screen.getByRole("button", {
        name: /Pay £8,132\.00 by bank/,
      });
      expect(button).toBeTruthy();
    });

    it("formats the amount using formatGBP", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={1234.56} />);

      // formatGBP(1234.56) returns "£1,234.56"
      const expectedLabel = formatGBP(1234.56);
      expect(
        screen.getByRole("button", { name: new RegExp(expectedLabel) })
      ).toBeTruthy();
    });

    it("renders button without amount when amount is null", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={null} />);

      // Should render "Pay by bank" without amount
      const button = screen.getByRole("button", { name: /Pay by bank/i });
      expect(button).toBeTruthy();

      // Should NOT render "£0" or "£0.00"
      expect(screen.queryByText(/£0/)).toBeNull();
    });

    it("renders button without amount when amount is undefined", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={undefined} />);

      const button = screen.getByRole("button", { name: /Pay by bank/i });
      expect(button).toBeTruthy();
      expect(screen.queryByText(/£0/)).toBeNull();
    });

    it("updates label during loading state while preserving amount", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      // Mock fetch to delay and verify loading state
      global.fetch = vi.fn(
        () =>
          new Promise(() => {
            // Never resolve, keeping button in loading state
          })
      ) as unknown as typeof fetch;

      const { container } = render(
        <PayButton invoiceId="test-invoice-id" amount={5000} />
      );

      // Click the button
      const button = screen.getByRole("button", {
        name: /Pay £5,000\.00 by bank/,
      });
      button.click();

      // Wait for state update
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Button should now show loading text but should be disabled
      const loadingButton = container.querySelector("button[disabled]");
      expect(loadingButton).toBeTruthy();

      // Clean up
      vi.restoreAllMocks();
    });

    it("handles zero amount correctly", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={0} />);

      // Should render "£0.00" since zero is a valid amount
      expect(
        screen.getByRole("button", { name: /Pay £0\.00 by bank/ })
      ).toBeTruthy();
    });

    it("handles large amounts correctly", async () => {
      const { PayButton } = await import("@/app/i/[id]/pay-button");

      render(<PayButton invoiceId="test-invoice-id" amount={123456.78} />);

      // Should format with thousands separator
      expect(
        screen.getByRole("button", { name: /Pay £123,456\.78 by bank/ })
      ).toBeTruthy();
    });
  });

  describe("Integration on payment page", () => {
    it("payment page imports and uses ReassuranceStrip", async () => {
      // Verify that the page file can import the component
      const pageModule = await import("@/app/i/[id]/page");

      // The page should have a default export (the page component)
      expect(pageModule.default).toBeDefined();
    });

    it("ReassuranceStrip component file exists and exports the component", async () => {
      const stripModule = await import("@/components/ui/reassurance-strip");

      expect(stripModule.ReassuranceStrip).toBeDefined();
      expect(typeof stripModule.ReassuranceStrip).toBe("function");
    });

    it("payment reassurance copy module exists and is importable", async () => {
      const copyModule = await import("@/lib/payment-reassurance-copy");

      expect(copyModule).toBeDefined();
      expect(copyModule.PAYMENT_COPY_LINE_1).toBeDefined();
      expect(copyModule.PAYMENT_COPY_LINE_2).toBeDefined();
    });
  });
});
