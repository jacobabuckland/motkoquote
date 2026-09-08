/**
 * A link in an SMS ends its line. Nothing is punctuated onto it.
 *
 * THE ORIGINAL THEORY WAS WRONG, and this file exists in spite of that rather
 * than because of it. On 8 Sep a customer's quote link was reported broken and
 * a trailing full stop was proposed as the cause; the production logs refuted
 * it — the failing request carried a clean UUID and the same Next.js error
 * digest as an unrelated `/dashboard` failure, and the real cause was an
 * unguarded notification throwing after the write had already committed (P0·2).
 * Nothing here fixes an observed break, and it must not be read as evidence
 * that one occurred.
 *
 * What survives the correction is that three of the four senders really did
 * emit `…{url}. Reply STOP to opt out.`, with a full stop against the last
 * character of a URL. Handset and carrier link detection is not something this
 * codebase controls or can test, a link is the entire point of the message, and
 * a line break costs nothing.
 *
 * The second finding is measurable rather than speculative: every body carried
 * an em dash, which is not in the GSM-7 alphabet. One such character forces the
 * WHOLE message to UCS-2, halving the segment size from 160 characters to 70 —
 * so these were being split and billed roughly twice over for a dash.
 *
 * Asserted through the WIRE, by stubbing fetch and reading the Body parameter
 * actually posted to Twilio. That is deliberate on two counts: it is what the
 * customer receives rather than what some intermediate helper returns, and the
 * bodies cannot move to exported builders anyway — tests/acceptance/
 * lifecycle-send-dispatcher.test.ts slices this file's source from each
 * sender's declaration to its return looking for the STOP line, and it is
 * frozen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  sendChaseSms,
  sendContractSms,
  sendInvoiceSms,
  sendQuoteSms,
} from "@/lib/sms";

const URL_UNDER_TEST = "https://motko.app/q/71d82dd1-e8cb-44b0-9a8f-9f7fd89dc697";
const OPT_OUT_LINE = "Reply STOP to opt out.";

const posted: string[] = [];

beforeEach(() => {
  posted.length = 0;
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "token_test");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+447700900000");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url?: string, init?: { body?: URLSearchParams }) => {
      posted.push(init?.body?.get("Body") ?? "");
      return { ok: true, text: async () => "" } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Sends one of each and returns the four bodies Twilio was handed. */
const everyBody = async (): Promise<{ name: string; body: string }[]> => {
  await sendQuoteSms({
    to: "+447700900001",
    companyName: "Acme Building Ltd",
    total: 7200,
    vatRegistered: true,
    quoteUrl: URL_UNDER_TEST,
  });
  await sendChaseSms({
    to: "+447700900001",
    companyName: "Acme Building Ltd",
    body: "Your invoice is due on Friday.",
    paymentUrl: URL_UNDER_TEST,
    payEnabled: true,
  });
  await sendContractSms({
    to: "+447700900001",
    companyName: "Acme Building Ltd",
    contractUrl: URL_UNDER_TEST,
  });
  await sendInvoiceSms({
    to: "+447700900001",
    companyName: "Acme Building Ltd",
    amount: 1200,
    invoiceType: "deposit",
    paymentUrl: URL_UNDER_TEST,
  });

  const names = ["quote", "chase", "contract", "invoice"];
  expect(posted, "all four senders must have posted").toHaveLength(4);
  return posted.map((body, i) => ({ name: names[i], body }));
};

describe("every message puts its link at the end of a line", () => {
  it("never punctuates the character after a URL", async () => {
    for (const { name, body } of await everyBody()) {
      const line = body.split("\n").find((l) => l.includes(URL_UNDER_TEST));
      expect(line, `${name}: no line carries the link`).toBeDefined();
      expect(line?.endsWith(URL_UNDER_TEST), `${name}: something follows the link`).toBe(true);
    }
  });

  it("still carries the opt-out UK PECR requires, on its own line", async () => {
    for (const { name, body } of await everyBody()) {
      expect(body.split("\n"), name).toContain(OPT_OUT_LINE);
    }
  });

  it("leaves no blank line when a chase has no payment URL", async () => {
    await sendChaseSms({
      to: "+447700900001",
      companyName: "Acme",
      body: "Your invoice is due on Friday.",
      paymentUrl: null,
      payEnabled: false,
    });

    const body = posted[0];
    expect(body).not.toContain("http");
    expect(body.split("\n").filter((l) => l.trim() === "")).toHaveLength(0);
    expect(body).toContain(OPT_OUT_LINE);
  });
});

describe("the message stays in the GSM-7 alphabet", () => {
  // Not a full GSM 03.38 validator — that is easy to get subtly wrong. These
  // are the specific characters this codebase's own copy reaches for, each of
  // which alone forces the whole message to UCS-2 and halves the segment size.
  const FORCES_UCS2 = /[—–‘’“”…]/;

  it("carries no em dash, en dash, curly quote or ellipsis", async () => {
    for (const { name, body } of await everyBody()) {
      expect(body, `${name}: ${body}`).not.toMatch(FORCES_UCS2);
    }
  });

  it("still allows the pound sign, which IS in GSM-7", async () => {
    // Guarding the guard: a rule that pushed £ out of these messages would make
    // every amount unreadable to save nothing.
    const [, , , invoice] = await everyBody();
    expect(invoice.body).toContain("£");
  });
});

describe("what the quote message says", () => {
  it("names the business and the reason, then the link, then the opt-out", async () => {
    const [quote] = await everyBody();

    const [lead, link, optOut] = quote.body.split("\n");
    expect(lead).toContain("Acme Building Ltd");
    expect(lead).toContain("quote");
    expect(link).toBe(URL_UNDER_TEST);
    expect(optOut).toBe(OPT_OUT_LINE);
  });

  it("keeps the chase link behind its call-to-action label, URL last", async () => {
    const [, chase] = await everyBody();

    const link = chase.body.split("\n").find((l) => l.includes(URL_UNDER_TEST));
    expect(link).toMatch(/: https:\/\//);
    expect(link?.endsWith(URL_UNDER_TEST)).toBe(true);
  });
});
