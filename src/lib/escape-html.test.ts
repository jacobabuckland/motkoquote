import { describe, it, expect, vi, beforeEach } from "vitest";
import { escapeHtml } from "@/lib/escape-html";

const h = vi.hoisted(() => ({
  send: vi.fn(async (_args: { html: string }) => ({ error: null })),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: h.send };
  },
}));

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });

  it("escapes & first so introduced entities are not double-escaped", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves benign text untouched", () => {
    expect(escapeHtml("Dave Smith")).toBe("Dave Smith");
  });
});

// Hostile-fixture integration: a malicious customer name must never reach the
// contractor's inbox as live markup. Mirrors M2/#3 — the phishing-link scenario.
describe("email senders neutralise HTML injection (M2/#3)", () => {
  beforeEach(() => {
    h.send.mockClear();
    process.env.RESEND_API_KEY = "test-key";
  });

  const htmlOf = () => (h.send.mock.calls[0]![0] as { html: string }).html;
  const PHISH = `<a href="https://evil.example/pay">Pay here</a>`;

  it("escapes a phishing anchor injected via a customer name in the quote email", async () => {
    const { sendQuoteEmail } = await import("@/lib/email");
    await sendQuoteEmail({
      to: "dave@example.com",
      customerName: PHISH,
      companyName: "Acme",
      quoteUrl: "https://motko.app/q/1",
      total: 100,
    });
    const html = htmlOf();
    expect(html).not.toContain(PHISH);
    expect(html).toContain("&lt;a href=&quot;https://evil.example/pay&quot;&gt;");
  });

  it("escapes injection composed into a contractor notification heading", async () => {
    const { sendContractorNotificationEmail } = await import("@/lib/email");
    await sendContractorNotificationEmail({
      to: "trade@example.com",
      subject: "New activity",
      heading: `${PHISH} accepted your quote.`,
      nextStep: "Send them a contract.",
      jobUrl: "https://motko.app/jobs/1",
    });
    const html = htmlOf();
    expect(html).not.toContain(PHISH);
    expect(html).toContain("&lt;a href=");
  });

  it("escapes an LLM-drafted chase body before converting newlines", async () => {
    const { sendChaseEmail } = await import("@/lib/email");
    await sendChaseEmail({
      to: "dave@example.com",
      companyName: "Acme",
      body: `Line one\n${PHISH}`,
      paymentUrl: "https://motko.app/i/1",
    });
    const html = htmlOf();
    expect(html).not.toContain(PHISH);
    // Newlines still render as <br/>, but the injected markup is inert.
    expect(html).toContain("Line one<br/>");
    expect(html).toContain("&lt;a href=");
  });
});
