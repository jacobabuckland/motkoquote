import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderQuotePdfFromPayload, quoteRowToPdfPayload } from "@/lib/pdf/render-quote";
import { guestQuoteToPdfPayload } from "@/lib/guest/pdf";
import { compileDraftToLineItems } from "@/lib/compile-draft";
import type { LineItem } from "@/lib/schemas/job";

// Every assertion here is against the rendered document, decompressed. A line
// item's props are not evidence of what a customer reads; the content stream is.
const pdfText = (buffer: Buffer): string => {
  const raw = buffer.toString("latin1");
  const words: string[] = [];
  for (const stream of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(stream[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue; // Font data or an image, not a content stream.
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

// The compiler is the only thing that knows a rate lookup came back empty, so
// the fixtures below come OUT of it rather than being hand-written — that keeps
// the test honest about what production actually produces.
const compileLabourWith = (dayRate: number | null) =>
  compileDraftToLineItems(
    [
      {
        kind: "labour",
        description: "Full rewire - three-bed semi",
        people: [{ ref: "owner", days: 5 }],
        includes_tasks: [],
        overtime: false,
      },
    ],
    {
      day_rate: dayRate,
      overtime_rate: null,
      markup_pct: null,
      team_members: [],
      rate_cards: [],
      known_material_prices: [],
      owner_label: "Owner",
    },
    [],
  );

const materials: LineItem = {
  description: "Twin & earth 2.5mm",
  category: "materials",
  quantity: 100,
  unit: "m",
  unit_price: 1.85,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
};

const authenticatedDocument = async (lineItems: LineItem[]) =>
  pdfText(
    await renderQuotePdfFromPayload(
      quoteRowToPdfPayload("11111111-2222-4333-8444-555555555555", {
        created_at: "2026-03-14T09:30:00.000Z",
        line_items_json: lineItems,
        job: {
          extracted_json: { job_type: "Full rewire" },
          // No statement of work: this fixture pins the unpriced-line
          // document, which the scope section does not affect.
          sow_json: null,
          customer: { name: "Luca Feser", contact: { phone: "07700 900123" } },
          contractor: {
            company_name: "Buckland Electrical Ltd",
            company_number: "09876543",
            trade: "Electrician",
            vat_registered: false,
            vat_number: null,
            branding: {},
          },
        },
      }),
    ),
  );

describe("a document with a line the compiler could not price", () => {
  it("prints no £0.00 for that line — authenticated path", async () => {
    const { lineItems } = compileLabourWith(null);
    expect(lineItems[0]?.unpriced, "compiler did not mark the line").toBe(true);

    const text = await authenticatedDocument([...lineItems, materials]);

    // The defect: a branded, sendable quote reading LABOUR … £0.00 / Total £0.00.
    expect(text).not.toContain("£0.00");
    // The priced line is untouched.
    expect(text).toContain("£185.00");
  }, 30_000);

  it("says outright that the figure is outstanding, and does not call the sum a total", async () => {
    const { lineItems } = compileLabourWith(null);
    const text = await authenticatedDocument([...lineItems, materials]);

    expect(text).toContain("Not priced");
    expect(text).toMatch(/still to be confirmed/i);
    expect(text).toContain("To be confirmed");

    // The money block must not claim completeness while a line is outstanding.
    expect(text).toContain("Priced so far");
    expect(text).toMatch(/This quote is not complete/i);
    expect(text).toMatch(/not included in the figure above/i);
  }, 30_000);

  it("does not print Estimated on a line that has no price behind it", async () => {
    // "Estimated" marks a real figure that may move. On an absent figure it
    // only lends the absence credibility, which is worse than no marker.
    const { lineItems } = compileLabourWith(null);

    const authenticated = await authenticatedDocument([...lineItems, materials]);
    expect(authenticated).not.toContain("Estimated");

    const guest = pdfText(
      await renderQuotePdfFromPayload(
        guestQuoteToPdfPayload({
          reference: "ABCD1234",
          createdAt: "2026-03-14T09:30:00.000Z",
          jobType: "Full rewire",
          lineItems: [...lineItems, materials],
          subtotal: 185,
          total: 185,
          customer: { name: "Luca Feser" },
          contractorFlags: [],
          unpricedLabour: true,
        }),
      ),
    );
    expect(guest).not.toContain("Estimated");
    expect(guest).not.toContain("£0.00");
    expect(guest).toContain("Not priced");
    expect(guest).toContain("Priced so far");
  }, 30_000);

  it("leaves a quote with a resolved rate completely unchanged", async () => {
    const { lineItems } = compileLabourWith(340);
    expect(lineItems[0]?.unpriced).toBeUndefined();

    const text = await authenticatedDocument([...lineItems, materials]);

    expect(text).toContain("£1,700.00"); // 5 days x £340
    expect(text).toContain("Total");
    expect(text).not.toContain("Priced so far");
    expect(text).not.toContain("Not priced");
    expect(text).not.toMatch(/This quote is not complete/i);
  }, 30_000);

  it("still prices a deliberately zeroed line as a real £0.00", async () => {
    // A goodwill callout or a customer-supplied material is a genuine zero and
    // must keep reading as one — the unpriced state is for absent figures only.
    const goodwill: LineItem = {
      description: "First visit — no charge",
      category: "callout",
      quantity: 1,
      unit: "job",
      unit_price: 0,
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: false,
    };

    const text = await authenticatedDocument([materials, goodwill]);

    expect(text).toContain("£0.00");
    expect(text).not.toContain("Not priced");
    expect(text).not.toContain("Priced so far");
  }, 30_000);
});
