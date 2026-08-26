// quotes.total is VAT-inclusive — computeQuoteTotals returns subtotal + vat —
// and the SMS and the email were the only two surfaces that printed it with no
// indication of that. Every document surface shows subtotal, VAT and total
// separately, so the figure is unambiguous there. In a one-line message it is
// not, and it matters in opposite directions: for a consumer the VAT-inclusive
// figure is the one that counts and they will assume it; for a business
// customer it is the one that does not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMessageAmount } from "@/lib/money-label";

const sent: Array<Record<string, string>> = [];

beforeEach(() => {
  sent.length = 0;
  process.env.TWILIO_ACCOUNT_SID = "AC-test";
  process.env.TWILIO_AUTH_TOKEN = "token";
  process.env.TWILIO_FROM_NUMBER = "+447000000000";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
      sent.push(Object.fromEntries(init.body.entries()));
      return { ok: true, text: async () => "" };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const COMPANY = "Buckland Electrical Services";
const URL_ = "https://motko.app/q/3c81e4f9-08b4-8171-a302-dd9a836cc3a1";

const sendQuote = async (total: number, vatRegistered?: boolean) => {
  const { sendQuoteSms } = await import("@/lib/sms");
  await sendQuoteSms({
    to: "+447700900000",
    companyName: COMPANY,
    total,
    ...(vatRegistered === undefined ? {} : { vatRegistered }),
    quoteUrl: URL_,
  });
  return sent.at(-1)?.Body ?? "";
};

describe("formatMessageAmount", () => {
  it("labels the figure for a VAT-registered trade", () => {
    expect(formatMessageAmount(114, true)).toBe("£114.00 inc. VAT");
  });

  it("says nothing about VAT for a trade that is not registered", () => {
    // "£114.00 inc. VAT" on a non-registered trade's quote is a false
    // statement about what the customer owes.
    expect(formatMessageAmount(114, false)).toBe("£114.00");
  });

  it("treats an unknown registration as not registered", () => {
    // Under-labelling is the safe direction: a bare figure is ambiguous, a
    // wrong label is wrong.
    expect(formatMessageAmount(114, undefined)).toBe("£114.00");
  });

  it("does not label a £0 quote, which is a real case", () => {
    // A goodwill callout or a warranty visit — see ZERO_TOTAL_CONFIRM_REQUIRED.
    // There is no VAT on nothing, and the qualifier reads as a mistake.
    expect(formatMessageAmount(0, true)).toBe("£0.00");
  });
});

describe("the quote SMS", () => {
  it("names the figure as VAT-inclusive when it is", async () => {
    const body = await sendQuote(114, true);

    expect(body).toContain("£114.00 inc. VAT");
  });

  it("carries no VAT wording at all when the trade is not registered", async () => {
    const body = await sendQuote(114, false);

    expect(body).toContain("£114.00");
    expect(body).not.toMatch(/VAT/i);
  });

  it("does not change the figure itself", async () => {
    // The label says what the number is. A second computation here would be a
    // second thing that can drift from quotes.total.
    for (const vat of [true, false]) {
      expect(await sendQuote(114, vat)).toContain("£114.00");
    }
  });

  it("still fits one 160-character segment with the label", async () => {
    const body = await sendQuote(114, true);

    expect(body.length).toBeLessThanOrEqual(160);
  });

  it("keeps the PECR transactional requirements", async () => {
    // Identifies the business, states the reason for contact, carries the
    // opt-out. Adding a label must not push any of them out.
    const body = await sendQuote(114, true);

    expect(body).toContain(COMPANY);
    expect(body).toContain("quote");
    expect(body).toContain("Reply STOP to opt out.");
    expect(body).toContain(URL_);
  });
});

describe("the other lifecycle messages are untouched", () => {
  it("the contract SMS carries no VAT wording", async () => {
    const { sendContractSms } = await import("@/lib/sms");
    await sendContractSms({
      to: "+447700900000",
      companyName: COMPANY,
      contractUrl: URL_,
    });

    expect(sent.at(-1)?.Body).not.toMatch(/VAT/i);
  });

  it("the invoice SMS carries no VAT wording", async () => {
    // An invoice states a payable amount whose VAT treatment is a different
    // question, deliberately out of scope here.
    const { sendInvoiceSms } = await import("@/lib/sms");
    await sendInvoiceSms({
      to: "+447700900000",
      companyName: COMPANY,
      amount: 114,
      invoiceType: "final",
      paymentUrl: URL_,
    });

    expect(sent.at(-1)?.Body).not.toMatch(/VAT/i);
  });
});

// The wiring. The formatter being correct proves nothing if sendQuote never
// passes the flag — and it very nearly did not: `vat_registered` was missing
// from its select, so the value would have been undefined in production while
// every unit test above stayed green. Same shape as #369.
const h = vi.hoisted(() => {
  const notifyCustomer = vi.fn<
    (input: { vatRegistered?: boolean; amount?: number }) => Promise<{
      delivered: boolean;
      email: { attempted: boolean; delivered: boolean };
      sms: { attempted: boolean; delivered: boolean };
    }>
  >(async () => ({
    delivered: true,
    email: { attempted: true, delivered: true },
    sms: { attempted: false, delivered: false },
  }));

  const job = {
    contractor_id: "c-1",
    customer_id: "cust-1",
    sow_json: null,
    contractor: { company_name: "Buckland Electrical", vat_registered: true },
  };
  const quote = {
    total: 114,
    line_items_json: [],
    drafted_line_items_json: null,
    contractor_flags_json: [],
  };

  const client = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => b;
      b.insert = () => b;
      b.update = () => b;
      b.single = () =>
        Promise.resolve({
          data: table === "jobs" ? job : table === "quotes" ? quote : null,
          error: null,
        });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: [{ id: "q-1" }], error: null });
      return b;
    },
  };

  return { client, notifyCustomer };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/notify-customer", () => ({ notifyCustomer: h.notifyCustomer }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(async () => {}), logError: vi.fn(async () => {}) }));
vi.mock("@/lib/quote-learning", () => ({
  diffLineItems: vi.fn(() => []),
  recordQuoteEdits: vi.fn(async () => {}),
  getContractorTendencies: vi.fn(async () => []),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("sendQuote actually passes the registration through", () => {
  it("hands the dispatcher vatRegistered, read from the contractor row", async () => {
    const { sendQuote } = await import("@/app/jobs/actions");

    await sendQuote({
      jobId: "00000000-0000-4000-8000-000000000001",
      quoteId: "00000000-0000-4000-8000-000000000002",
      customer: { name: "Luca Feser", email: "luca@example.test" },
      channels: { email: true, sms: false },
    });

    expect(h.notifyCustomer).toHaveBeenCalledTimes(1);
    const call = h.notifyCustomer.mock.calls[0][0];
    expect(call.amount).toBe(114);
    // Undefined here means the select dropped the column and no quote would
    // ever carry the label.
    expect(call.vatRegistered).toBe(true);
  });
});
