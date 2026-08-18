import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Issue #175: Sanitise transactional email subject lines
 *
 * These tests verify that a shared sanitizeEmailSubject helper exists,
 * removes control characters and excess whitespace, and is used by all
 * transactional email functions that interpolate the company name.
 */

// Mock Resend at the top level to prevent actual API calls
const mockSend = vi.fn();
// A class, not vi.fn().mockImplementation: email.ts calls `new Resend(...)`,
// and an arrow returned from mockImplementation is not a constructor — which
// failed eight of these tests with "is not a constructor" while the sanitiser
// itself was fine. This is the shape src/lib/escape-html.test.ts already uses.
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

describe("Issue #175: Sanitise transactional email subject lines", () => {
  describe("sanitizeEmailSubject helper", () => {
    it("is exported from src/lib/email.ts", async () => {
      const mod = await import("../../src/lib/email");
      expect(mod.sanitizeEmailSubject).toBeDefined();
      expect(typeof mod.sanitizeEmailSubject).toBe("function");
    });

    it("removes embedded newlines", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith\nSons")).toBe("SmithSons");
      expect(sanitizeEmailSubject("Smith\n\nSons")).toBe("SmithSons");
    });

    it("removes carriage returns", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith\rSons")).toBe("SmithSons");
      expect(sanitizeEmailSubject("Smith\r\nSons")).toBe("SmithSons");
    });

    it("removes tabs", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith\tSons")).toBe("SmithSons");
    });

    it("collapses multiple consecutive spaces to a single space", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith  &  Sons")).toBe("Smith & Sons");
      expect(sanitizeEmailSubject("Smith    Sons")).toBe("Smith Sons");
    });

    it("trims leading whitespace", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("  Smith & Sons")).toBe("Smith & Sons");
      expect(sanitizeEmailSubject("\n\nSmith & Sons")).toBe("Smith & Sons");
    });

    it("trims trailing whitespace", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith & Sons  ")).toBe("Smith & Sons");
      expect(sanitizeEmailSubject("Smith & Sons\n\n")).toBe("Smith & Sons");
    });

    it("handles empty string", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("")).toBe("");
    });

    it("handles whitespace-only string", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("   ")).toBe("");
      expect(sanitizeEmailSubject("\n\n")).toBe("");
      expect(sanitizeEmailSubject("\t\t")).toBe("");
    });

    it("handles string with only control characters", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("\r\n\t")).toBe("");
    });

    it("preserves clean names unchanged", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith & Sons")).toBe("Smith & Sons");
      expect(sanitizeEmailSubject("Smith & Sons Ltd.")).toBe("Smith & Sons Ltd.");
    });

    it("preserves legitimate punctuation", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("O'Neill Plumbing")).toBe("O'Neill Plumbing");
      expect(sanitizeEmailSubject("Smith & Sons Ltd.")).toBe("Smith & Sons Ltd.");
      expect(sanitizeEmailSubject("Acme, Inc.")).toBe("Acme, Inc.");
    });

    it("preserves non-Latin characters", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Müller GmbH")).toBe("Müller GmbH");
      expect(sanitizeEmailSubject("Café Lumière")).toBe("Café Lumière");
    });

    it("preserves emoji", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("Smith & Sons 🏗️")).toBe("Smith & Sons 🏗️");
    });

    it("handles complex real-world case: multiple issues combined", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");
      expect(sanitizeEmailSubject("  Smith\n&\r\nSons  Ltd.  ")).toBe("Smith&Sons Ltd.");
    });
  });

  describe("sendQuoteEmail uses sanitizeEmailSubject", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("sanitizes the company name in the subject line", async () => {
      const { sendQuoteEmail } = await import("../../src/lib/email");

      await sendQuoteEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith\nSons",
        quoteUrl: "https://motko.app/q/123",
        total: 1000,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Your quote from SmithSons",
        })
      );
    });

    it("sanitizes doubled spaces in the company name", async () => {
      const { sendQuoteEmail } = await import("../../src/lib/email");

      await sendQuoteEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith  &  Sons",
        quoteUrl: "https://motko.app/q/123",
        total: 1000,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Your quote from Smith & Sons",
        })
      );
    });
  });

  describe("sendInvoiceEmail uses sanitizeEmailSubject", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("sanitizes the company name in the deposit invoice subject", async () => {
      const { sendInvoiceEmail } = await import("../../src/lib/email");

      await sendInvoiceEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith\nSons",
        amount: 500,
        invoiceType: "deposit",
        paymentUrl: "https://motko.app/pay/123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Deposit invoice from SmithSons",
        })
      );
    });

    it("sanitizes the company name in the final invoice subject", async () => {
      const { sendInvoiceEmail } = await import("../../src/lib/email");

      await sendInvoiceEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith  &  Sons",
        amount: 1000,
        invoiceType: "final",
        paymentUrl: "https://motko.app/pay/123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Invoice from Smith & Sons",
        })
      );
    });
  });

  describe("sendContractEmail uses sanitizeEmailSubject", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("sanitizes the company name in the subject line", async () => {
      const { sendContractEmail } = await import("../../src/lib/email");

      await sendContractEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith\nSons",
        contractUrl: "https://motko.app/contract/123",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Contract to sign from SmithSons",
        })
      );
    });
  });

  describe("sendChaseEmail uses sanitizeEmailSubject", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("sanitizes the company name in the payment reminder subject", async () => {
      const { sendChaseEmail } = await import("../../src/lib/email");

      await sendChaseEmail({
        to: "customer@example.com",
        companyName: "Smith  &  Sons",
        body: "Please pay your invoice.",
        paymentUrl: "https://motko.app/pay/123",
        payEnabled: true,
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Payment reminder — Smith & Sons",
        })
      );
    });
  });

  describe("sendAccountDeletionEmail is untouched", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("has a static subject with no company name interpolation", async () => {
      const { sendAccountDeletionEmail } = await import("../../src/lib/email");

      await sendAccountDeletionEmail({
        to: "contractor@example.com",
        purgeDate: "2026-09-12",
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: "Your Motko account is scheduled for deletion",
        })
      );
    });
  });

  describe("Email bodies are untouched", () => {
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      mockSend.mockClear();
      mockSend.mockResolvedValue({ error: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("still uses escapeHtml for company name in quote email body", async () => {
      const { sendQuoteEmail } = await import("../../src/lib/email");

      await sendQuoteEmail({
        to: "customer@example.com",
        customerName: "Jane",
        companyName: "Smith & Sons",
        quoteUrl: "https://motko.app/q/123",
        total: 1000,
      });

      const htmlArg = mockSend.mock.calls[0][0].html;
      // escapeHtml preserves the company name in the body but with HTML escaping
      expect(htmlArg).toContain("Smith &amp; Sons");
    });
  });

  describe("Integration: no newline can appear in sent subject", () => {
    it("prevents mail header injection via company name", async () => {
      const { sanitizeEmailSubject } = await import("../../src/lib/email");

      // A malicious or accidental newline in the company name
      const maliciousName = "Smith\nBcc: attacker@evil.com";
      const sanitized = sanitizeEmailSubject(maliciousName);

      // The newline must be gone
      expect(sanitized).not.toContain("\n");
      expect(sanitized).not.toContain("\r");

      // The result should be a single line
      expect(sanitized.split("\n").length).toBe(1);
    });
  });
});
