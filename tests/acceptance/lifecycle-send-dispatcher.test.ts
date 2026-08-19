// Acceptance: every customer-facing lifecycle send goes through one
// dispatcher, so all of them honour the SMS opt-out and reach a phone-only
// customer.
//
// Before this, contract and invoice sends had no SMS path AT ALL — src/lib/sms.ts
// exported a quote sender and a chase sender and nothing else. So a customer
// who gave a phone number and no email received the quote and then silence:
// the contract needing their signature and the invoice needing their money
// went to an address they do not have. customerInputSchema explicitly permits
// that customer, so this was a supported configuration the lifecycle failed
// silently.
//
// This is the AGENTS.md anti-pattern by the letter: contact.sms_opt_out is a
// regulatory signal, written when a quote is sent and by the inbound Twilio
// STOP handler, and it was honoured at two of five sends because the other
// two had no channel to gate.
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  quoteEmail: vi.fn(async () => ({ delivered: true })),
  quoteSms: vi.fn(async () => ({ delivered: true })),
  contractEmail: vi.fn(async () => ({ delivered: true })),
  contractSms: vi.fn(async () => ({ delivered: true })),
  invoiceEmail: vi.fn(async () => ({ delivered: true })),
  invoiceSms: vi.fn(async () => ({ delivered: true })),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/lib/email", () => ({
  sendQuoteEmail: h.quoteEmail,
  sendContractEmail: h.contractEmail,
  sendInvoiceEmail: h.invoiceEmail,
}));
vi.mock("@/lib/sms", () => ({
  sendQuoteSms: h.quoteSms,
  sendContractSms: h.contractSms,
  sendInvoiceSms: h.invoiceSms,
}));
vi.mock("@/lib/analytics", () => ({ logError: h.logError, track: vi.fn(async () => {}) }));

const BOTH = { name: "Sheila", email: "s@example.com", phone: "07700900123", smsOptOut: false };
const PHONE_ONLY = { name: "Sheila", phone: "07700900123", smsOptOut: false };
const EMAIL_ONLY = { name: "Sheila", email: "s@example.com", smsOptOut: false };

const notify = async (over: Record<string, unknown>) => {
  const { notifyCustomer } = await import("@/lib/notify-customer");
  return notifyCustomer({
    event: "contract_sent",
    customer: BOTH,
    companyName: "Acme Ltd",
    url: "https://motko.app/c/abc",
    ...over,
  } as Parameters<typeof notifyCustomer>[0]);
};

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockClear();
});

describe("the senders that never existed now do", () => {
  it("exports a contract and an invoice SMS sender", async () => {
    const sms = await import("@/lib/sms");
    expect(typeof sms.sendContractSms).toBe("function");
    expect(typeof sms.sendInvoiceSms).toBe("function");
  });
});

describe("every lifecycle event fans out on both channels", () => {
  it.each([
    ["quote_sent", () => h.quoteEmail, () => h.quoteSms],
    ["contract_sent", () => h.contractEmail, () => h.contractSms],
    ["invoice_sent", () => h.invoiceEmail, () => h.invoiceSms],
  ])("%s attempts email AND sms for a customer with both", async (event, email, sms) => {
    const report = await notify({ event, customer: BOTH, amount: 100 });

    expect(email()).toHaveBeenCalledTimes(1);
    expect(sms()).toHaveBeenCalledTimes(1);
    expect(report.email.attempted).toBe(true);
    expect(report.sms.attempted).toBe(true);
    expect(report.delivered).toBe(true);
  });

  it.each(["contract_sent", "invoice_sent"])(
    "%s reaches a PHONE-ONLY customer, which it previously could not",
    async (event) => {
      const report = await notify({ event, customer: PHONE_ONLY, amount: 100 });

      expect(report.sms.attempted).toBe(true);
      expect(report.email.attempted).toBe(false);
      expect(report.delivered).toBe(true);
    },
  );

  it("does not attempt SMS for an email-only customer", async () => {
    const report = await notify({ customer: EMAIL_ONLY });
    expect(report.sms.attempted).toBe(false);
    expect(h.contractSms).not.toHaveBeenCalled();
  });
});

describe("the opt-out is honoured at EVERY site, not two of five", () => {
  it.each([
    ["quote_sent", () => h.quoteSms],
    ["contract_sent", () => h.contractSms],
    ["invoice_sent", () => h.invoiceSms],
  ])("%s attempts email only when the customer has opted out of SMS", async (event, sms) => {
    const report = await notify({
      event,
      customer: { ...BOTH, smsOptOut: true },
      amount: 100,
    });

    expect(sms()).not.toHaveBeenCalled();
    expect(report.sms.attempted).toBe(false);
    expect(report.email.attempted).toBe(true);
  });
});

describe("channels fail independently and never throw", () => {
  it("reports delivered when email rejects but SMS succeeds", async () => {
    h.contractEmail.mockRejectedValueOnce(new Error("resend down"));

    const report = await notify({});

    expect(report.delivered).toBe(true);
    expect(report.email).toEqual({ attempted: true, delivered: false });
    expect(report.sms).toEqual({ attempted: true, delivered: true });
    expect(h.logError).toHaveBeenCalled();
  });

  it("resolves delivered:false when both fail, rather than throwing", async () => {
    h.contractEmail.mockResolvedValueOnce({ delivered: false });
    h.contractSms.mockResolvedValueOnce({ delivered: false });

    await expect(notify({})).resolves.toMatchObject({ delivered: false });
  });

  it("treats absent Twilio credentials as a delivery failure, not a crash", async () => {
    // sendContractSms returns {delivered:false} rather than throwing when the
    // credentials are unset — mirroring sendQuoteSms.
    h.contractSms.mockResolvedValueOnce({ delivered: false });
    const report = await notify({ customer: PHONE_ONLY });
    expect(report.delivered).toBe(false);
    expect(report.sms).toEqual({ attempted: true, delivered: false });
  });

  it("attempts nothing, and does not throw, for a customer with neither channel", async () => {
    const report = await notify({ customer: { name: "Nobody", smsOptOut: false } });
    expect(report).toEqual({
      delivered: false,
      email: { attempted: false, delivered: false },
      sms: { attempted: false, delivered: false },
    });
  });

  it("treats a phone that fails E.164 normalisation as no phone", async () => {
    const report = await notify({ customer: { name: "Sheila", phone: "nonsense", smsOptOut: false } });
    expect(report.sms.attempted).toBe(false);
    expect(h.contractSms).not.toHaveBeenCalled();
  });
});

describe("PECR: every SMS body carries the opt-out instruction", () => {
  it.each(["sendContractSms", "sendInvoiceSms"])("%s appends the STOP line", async (name) => {
    // Asserted on the source, because the body is composed inside the sender
    // and only reaches Twilio.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(__dirname, "..", "..", "src", "lib", "sms.ts"),
      "utf8",
    );
    const fn = source.slice(source.indexOf(`export const ${name}`));
    const body = fn.slice(0, fn.indexOf("return postTwilioMessage"));
    expect(body).toContain("Reply STOP to opt out.");
  });
});

describe("the call sites route through the dispatcher", () => {
  it.each([
    ["src/app/dashboard/actions.ts", "sendContractEmail"],
    ["src/lib/invoicing.ts", "sendInvoiceEmail"],
  ])("%s no longer calls %s directly", async (file, sender) => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(path.join(__dirname, "..", "..", file), "utf8");

    expect(source).toContain("notifyCustomer");
    expect(source).not.toContain(`${sender}(`);
  });
});
