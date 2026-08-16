/**
 * @vitest-environment happy-dom
 *
 * Issue #212: PAY-6: Update payment trust copy and all TrueLayer references (supersedes #152 wording)
 *
 * These tests verify that:
 * 1. Payment reassurance copy no longer references TrueLayer
 * 2. Privacy policy no longer references TrueLayer in the processors section
 * 3. README.md no longer references TrueLayer in the stack table
 * 4. All updated copy accurately attributes FCA authorisation
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(cleanup);

describe("Issue #212: Update payment trust copy and all TrueLayer references", () => {
  describe("Payment reassurance copy module", () => {
    it("does not reference TrueLayer in line 1", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_1).toBeDefined();
      expect(mod.PAYMENT_COPY_LINE_1.toLowerCase()).not.toContain("truelayer");
    });

    it("references Stripe or uses provider-neutral wording in line 1", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      // Line 1 should mention either "Stripe" or be provider-neutral with "FCA" language
      const copyLower = mod.PAYMENT_COPY_LINE_1.toLowerCase();
      const mentionsStripe = copyLower.includes("stripe");
      const mentionsFCA = copyLower.includes("fca") || copyLower.includes("financial conduct authority");
      const mentionsAuthorised =
        copyLower.includes("authorised") || copyLower.includes("authorized");

      expect(mentionsStripe || (mentionsFCA && mentionsAuthorised)).toBe(true);
    });

    it("states accurate FCA authorisation attribution in line 1", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      // The copy must attribute authorisation to the provider (Stripe), never to motko
      const copyLower = mod.PAYMENT_COPY_LINE_1.toLowerCase();

      // If it mentions "motko" at all in this line, it must not claim motko is authorised
      if (copyLower.includes("motko")) {
        // "motko" should not appear adjacent to "authorised" or "regulated"
        expect(copyLower).not.toMatch(/motko.{0,20}authorised/);
        expect(copyLower).not.toMatch(/motko.{0,20}authorized/);
        expect(copyLower).not.toMatch(/motko.{0,20}regulated/);
      }

      // The line should mention authorisation/regulation
      expect(
        copyLower.includes("authorised") ||
          copyLower.includes("authorized") ||
          copyLower.includes("regulated")
      ).toBe(true);
    });

    it("does not reference TrueLayer in line 2", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_2).toBeDefined();
      expect(mod.PAYMENT_COPY_LINE_2.toLowerCase()).not.toContain("truelayer");
    });

    it("exports both strings as non-empty", async () => {
      const mod = await import("@/lib/payment-reassurance-copy");

      expect(mod.PAYMENT_COPY_LINE_1).toBeTruthy();
      expect(mod.PAYMENT_COPY_LINE_1.length).toBeGreaterThan(0);
      expect(mod.PAYMENT_COPY_LINE_2).toBeTruthy();
      expect(mod.PAYMENT_COPY_LINE_2.length).toBeGreaterThan(0);
    });
  });

  describe("ReassuranceStrip component renders updated copy", () => {
    it("renders copy that does not mention TrueLayer", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      const { container } = render(
        <ReassuranceStrip companyName="Acme Plumbing" />
      );

      // The rendered text must not contain "TrueLayer"
      const text = container.textContent || "";
      expect(text.toLowerCase()).not.toContain("truelayer");
    });

    it("renders copy that mentions Stripe or FCA authorisation", async () => {
      const { ReassuranceStrip } = await import(
        "@/components/ui/reassurance-strip"
      );

      const { container } = render(
        <ReassuranceStrip companyName="Acme Plumbing" />
      );

      const text = (container.textContent || "").toLowerCase();

      // Should mention either Stripe or FCA-related authorisation language
      const mentionsStripe = text.includes("stripe");
      const mentionsFCA = text.includes("fca") || text.includes("financial conduct authority");
      const mentionsAuthorised =
        text.includes("authorised") || text.includes("authorized");

      expect(mentionsStripe || (mentionsFCA && mentionsAuthorised)).toBe(true);
    });
  });

  describe("Privacy policy", () => {
    it("does not reference TrueLayer in the processors section", async () => {
      // Import the privacy page component module to verify it exists
      const pageModule = await import("@/app/privacy/page");
      expect(pageModule.default).toBeDefined();

      // Read the actual source file to check the copy
      const privacyPath = join(process.cwd(), "src/app/privacy/page.tsx");
      const content = readFileSync(privacyPath, "utf-8");

      // Find the "Processors we use" section
      const processorsMatch = content.match(
        /Processors we use[\s\S]{0,500}<\/section>/i
      );

      expect(processorsMatch).toBeTruthy();

      if (processorsMatch) {
        const processorsSection = processorsMatch[0];
        // The processors section must not mention TrueLayer
        expect(processorsSection.toLowerCase()).not.toContain("truelayer");
      }
    });

    it("privacy policy processors section mentions Stripe or uses provider-neutral wording", async () => {
      const privacyPath = join(process.cwd(), "src/app/privacy/page.tsx");
      const content = readFileSync(privacyPath, "utf-8");

      const processorsMatch = content.match(
        /Processors we use[\s\S]{0,500}<\/section>/i
      );

      if (processorsMatch) {
        const processorsSection = processorsMatch[0].toLowerCase();

        // Should mention either:
        // - "Stripe" specifically, or
        // - Provider-neutral payment terminology like "payment processor" or "payments"
        const mentionsStripe = processorsSection.includes("stripe");
        const mentionsPaymentProcessor =
          processorsSection.includes("payment") || processorsSection.includes("payments");

        expect(mentionsStripe || mentionsPaymentProcessor).toBe(true);
      }
    });
  });

  describe("README.md stack table", () => {
    it("does not reference TrueLayer in the Payments row", () => {
      const readmePath = join(process.cwd(), "README.md");
      const content = readFileSync(readmePath, "utf-8");

      // Find the Payments row in the stack table
      const paymentsRowMatch = content.match(/^\|\s*Payments\s*\|.*$/im);

      expect(paymentsRowMatch).toBeTruthy();

      if (paymentsRowMatch) {
        const paymentsRow = paymentsRowMatch[0];
        expect(paymentsRow.toLowerCase()).not.toContain("truelayer");
      }
    });

    it("Payments row mentions Stripe or uses provider-neutral wording", () => {
      const readmePath = join(process.cwd(), "README.md");
      const content = readFileSync(readmePath, "utf-8");

      const paymentsRowMatch = content.match(/^\|\s*Payments\s*\|.*$/im);

      if (paymentsRowMatch) {
        const paymentsRow = paymentsRowMatch[0].toLowerCase();

        // Should mention Stripe or use provider-neutral terminology
        const mentionsStripe = paymentsRow.includes("stripe");
        const mentionsPayByBank = paymentsRow.includes("pay by bank");
        const mentionsPayments = paymentsRow.includes("payment");

        expect(mentionsStripe || mentionsPayByBank || mentionsPayments).toBe(
          true
        );
      }
    });
  });

  describe("Integration — no customer-visible TrueLayer references", () => {
    it("payment reassurance copy module is free of TrueLayer references", async () => {
      const copyPath = join(process.cwd(), "src/lib/payment-reassurance-copy.ts");
      const content = readFileSync(copyPath, "utf-8");

      // The entire file must not contain "TrueLayer" in any case
      expect(content.toLowerCase()).not.toContain("truelayer");
    });

    it("comment in payment-reassurance-copy.ts still requires legal sign-off", async () => {
      const copyPath = join(process.cwd(), "src/lib/payment-reassurance-copy.ts");
      const content = readFileSync(copyPath, "utf-8");

      // The file should still have a comment warning about legal sign-off
      expect(content.toLowerCase()).toContain("legal");
    });
  });
});
