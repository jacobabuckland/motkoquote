import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderQuotePdfFromPayload } from "@/lib/pdf/render-quote";
import { guestQuoteToPdfPayload } from "@/lib/guest/pdf";
import type { GuestQuote } from "@/lib/guest/quote";
import type { LineItem } from "@/lib/schemas/job";

// Reads the visible text out of a rendered PDF, so these assertions are about
// what actually lands on the page rather than about what the props said.
// @react-pdf flate-compresses each content stream and writes glyphs as
// single-byte hex runs inside TJ arrays, so both layers have to come off.
const pdfText = (buffer: Buffer): string => {
  const raw = buffer.toString("latin1");
  const words: string[] = [];

  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(stream[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue; // Not a deflated stream (embedded font data, images).
    }

    for (const hexRun of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
      const hex = hexRun[1] ?? "";
      let word = "";
      for (let i = 0; i + 1 < hex.length; i += 2) {
        word += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      words.push(word);
    }
  }

  return words.join("");
};

const line: LineItem = {
  description: "Full rewire — three-bed semi",
  category: "labour",
  quantity: 5,
  unit: "day",
  unit_price: 340,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

const guestQuote = (overrides: Partial<GuestQuote> = {}): GuestQuote => ({
  reference: "ABCD1234",
  createdAt: "2026-03-14T09:30:00.000Z",
  jobType: "Full rewire",
  lineItems: [line],
  subtotal: 1700,
  total: 1700,
  customer: null,
  contractorFlags: [],
  unpricedLabour: false,
  ...overrides,
});

describe("a guest quote PDF", () => {
  it("omits the contractor identity block entirely rather than inventing one", async () => {
    const payload = guestQuoteToPdfPayload(guestQuote());
    expect(payload.contractor).toBeNull();

    const text = pdfText(await renderQuotePdfFromPayload(payload));

    // Nothing fabricated, and no empty labels left behind.
    expect(text).not.toMatch(/co\. no\./i);
    expect(text).not.toMatch(/vat/i);
    expect(text).not.toMatch(/customer/i);
    // The document still identifies itself and the work.
    expect(text).toContain("QUOTE");
    expect(text).toMatch(/ABCD1234/);
    expect(text).toContain("Full rewire");
  }, 30_000);

  it("prints a captured customer name as free text and omits the block otherwise", async () => {
    const withCustomer = guestQuoteToPdfPayload(
      guestQuote({ customer: { name: "Luca Feser", phone: "07700 900123" } }),
    );
    const text = pdfText(await renderQuotePdfFromPayload(withCustomer));

    expect(text).toMatch(/customer/i);
    expect(text).toContain("Luca Feser");
  }, 30_000);

  it("charges no VAT when there is no VAT-registered business behind it", async () => {
    const text = pdfText(await renderQuotePdfFromPayload(guestQuoteToPdfPayload(guestQuote())));
    expect(text).not.toMatch(/vat \(20%\)/i);
  }, 30_000);
});
