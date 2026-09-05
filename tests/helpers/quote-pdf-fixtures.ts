// Fixtures for the quote-PDF golden-render gate.
//
// These are the *stored row* shape `renderQuotePdf(quoteId)` selects — not the
// component's props — so the gate covers the row→props mapping as well as the
// document itself. Four cases, chosen to exercise every branch in PdfHeader
// and the totals block:
//
//   1. vat-registered contractor WITH a logo   → Image branch, VAT row, Co. No.
//   2. non-vat-registered contractor, NO logo  → monogram branch, no VAT row
//   3. contractor with branding.footer_terms   → PdfFooter's note branch
//   4. a line whose rate could not be resolved → the unpriced state, and a
//      total that does not claim completeness
//
// The logo is an inline data: URI (a 1x1 PNG) rather than a remote URL, so the
// render exercises the <Image> branch without a network fetch — a golden gate
// that depends on the internet is not a gate.
import type { LineItem } from "@/lib/schemas/job";

// 1x1 transparent PNG.
export const FIXTURE_LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const line = (overrides: Partial<LineItem> & Pick<LineItem, "description" | "category">): LineItem => ({
  quantity: 1,
  unit: "job",
  unit_price: 0,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

const LINE_ITEMS: LineItem[] = [
  line({
    description: "Full rewire — three-bed semi",
    category: "labour",
    quantity: 5,
    unit: "day",
    unit_price: 340,
    people: [
      { label: "Owner", days: 5, day_rate: 340 },
      { label: "Liam (apprentice)", days: 5, day_rate: 120 },
    ],
    includes_tasks: ["First fix", "Second fix", "Making good"],
  }),
  line({
    description: "Twin & earth 2.5mm",
    category: "materials",
    quantity: 100,
    unit: "m",
    unit_price: 1.85,
    supplied_by: "contractor",
  }),
  line({
    description: "Consumer unit (customer supplied)",
    category: "materials",
    quantity: 1,
    unit: "unit",
    unit_price: 0,
    supplied_by: "customer",
    customer_note: "Supplied by you",
  }),
  line({
    description: "Soil stack condition — provisional",
    category: "other",
    quantity: 1,
    unit: "job",
    unit_price: 450,
    assumed: true,
    provisional: true,
    assumption_note: "Contractor-facing: confirm against supplier price",
  }),
];

// A labour line the compiler could not price: the contractor has no configured
// day rate and stated none in the call, so the amount is ABSENT. `unpriced`
// carries that fact onto the document; the £0 unit_price/day_rate below are the
// fallbacks the compiler leaves behind, and are exactly what must NOT be
// printed as a figure.
const UNPRICED_LABOUR: LineItem = line({
  description: "Full rewire — three-bed semi",
  category: "labour",
  quantity: 5,
  unit: "day",
  unit_price: 0,
  people: [{ label: "Owner", days: 5, day_rate: 0 }],
  unpriced: true,
});

export type QuotePdfFixture = {
  key: string;
  quoteId: string;
  row: unknown;
};

// A fixed quote id per case: `reference` is derived from it (first 8 chars,
// uppercased), so it has to be stable for the hash to be.
// The scope of works a quote carries, as a stored sow_json. Only the fifth
// fixture has one: the original four must keep hashing exactly as they did
// before the scope section existed, which is what proves the change is additive
// and cannot alter a quote that has no SoW.
const FIXTURE_SOW = {
  job_type: "rewire",
  overview_narrative:
    "A full rewire of a three-bed semi, consumer unit included, over three working days.",
  rooms: [
    {
      name: "Kitchen",
      dimensions: "4m x 3m",
      work_items: ["Replace six sockets", "Move the cooker spur"],
    },
    { name: "Landing", dimensions: null, work_items: ["Two-way switch"] },
  ],
  additional_items: ["Haul the old cable away"],
  existing_conditions: "Old rubber cable throughout.",
  access_issues: "No working before 9am.",
  inclusions: ["Making good the chases"],
  exclusions: ["Redecoration"],
  materials_mentioned: ["6mm twin and earth"],
  materials_supply: { contractor_supplied: ["Cable"], customer_supplied: ["Light fittings"] },
  assumptions_and_unknowns: [
    { description: "Soil stack condition unknown", treatment: "provisional_sum" },
  ],
  labour_plan: { people_count: 2, duration_days: 3, crew_description: "me and Liam" },
  deadline: null,
  agreed_costs: null,
  pricing: null,
  timeline: null,
  notes: null,
  customer_name: null,
  site_address: null,
  customer_phone: null,
  customer_email: null,
  complete: true,
  next_question: null,
  reclassification_count: 0,
  used_generic_fallback: false,
  wrap_incomplete: false,
  unasked_required: [],
};

export const QUOTE_PDF_FIXTURES: QuotePdfFixture[] = [
  {
    key: "vat-registered-with-logo",
    quoteId: "aaaaaaaa-1111-4111-8111-111111111111",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      line_items_json: LINE_ITEMS,
      job: {
        extracted_json: { job_type: "Full rewire" },
        customer: {
          name: "Luca Feser",
          contact: {
            email: "luca@example.co.uk",
            phone: "07700 900123",
            address: "12 Norwich Road, Dereham, NR19 1AA",
          },
        },
        contractor: {
          company_name: "Buckland Electrical Ltd",
          company_number: "09876543",
          trade: "Electrician",
          vat_registered: true,
          vat_number: "GB123456782",
          branding: { brand_color: "#004225", logo_url: FIXTURE_LOGO_DATA_URI },
        },
      },
    },
  },
  {
    key: "non-vat-no-logo",
    quoteId: "bbbbbbbb-2222-4222-8222-222222222222",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      line_items_json: LINE_ITEMS,
      job: {
        extracted_json: { job_type: "Bathroom refit" },
        customer: {
          name: "Sam Okonkwo",
          contact: { phone: "07700 900456" },
        },
        contractor: {
          company_name: "S. Hartley Plumbing",
          company_number: null,
          trade: "Plumber",
          vat_registered: false,
          vat_number: null,
          branding: {},
        },
      },
    },
  },
  {
    key: "footer-terms",
    quoteId: "cccccccc-3333-4333-8333-333333333333",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      line_items_json: LINE_ITEMS,
      job: {
        extracted_json: { job_type: "Skim three ceilings" },
        customer: {
          name: "Dawn Whitaker",
          contact: { email: "dawn@example.com", address: "4 The Green, Dereham" },
        },
        contractor: {
          company_name: "Fenland Plastering",
          company_number: "11223344",
          trade: "Plasterer",
          vat_registered: true,
          vat_number: "GB000000097",
          branding: {
            brand_color: "#7c2d12",
            footer_terms:
              "Valid 30 days. 50% deposit on acceptance, balance on completion. Prices exclude scaffolding.",
          },
        },
      },
    },
  },
  {
    key: "unpriced-labour",
    quoteId: "dddddddd-4444-4444-8444-444444444444",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      // Materials priced, labour not. The document must show a real figure for
      // the one and an explicit absence for the other, and must not present the
      // materials-only sum as a complete total.
      line_items_json: [UNPRICED_LABOUR, LINE_ITEMS[1], LINE_ITEMS[2]],
      job: {
        extracted_json: { job_type: "Full rewire" },
        customer: {
          name: "Priya Raman",
          contact: { phone: "07700 900789" },
        },
        contractor: {
          company_name: "Norfolk Sparks",
          company_number: null,
          trade: "Electrician",
          vat_registered: false,
          vat_number: null,
          branding: {},
        },
      },
    },
  },
  {
    key: "with-scope",
    quoteId: "eeeeeeee-5555-4555-8555-555555555555",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      line_items_json: LINE_ITEMS,
      job: {
        extracted_json: { job_type: "Full rewire" },
        sow_json: FIXTURE_SOW,
        customer: {
          name: "Luca Feser",
          contact: {
            email: "luca@example.co.uk",
            phone: "07700 900123",
            address: "12 Norwich Road, Dereham, NR19 1AA",
          },
        },
        contractor: {
          company_name: "Buckland Electrical Ltd",
          company_number: "09876543",
          trade: "Electrician",
          vat_registered: true,
          vat_number: "GB123456782",
          branding: { brand_color: "#004225" },
        },
      },
    },
  },
];

// Reduces a rendered PDF to the things a golden gate should actually pin: what
// the document SAYS, not the order the writer happened to emit it in.
//
// Two fields change on every render regardless of input — the /CreationDate
// timestamp and the /ID nonce (an MD5 over content + time). Without blanking
// those, no golden over this renderer can pass, not even against itself.
//
// Everything else here exists because of a defect chased across three days
// (2026-08-24 to 25). contract-pdf-golden failed intermittently — roughly one
// full-suite run in three — always on one template, never the same one twice,
// and never in isolation. Capturing both PDFs from a failing process settled it:
//
//   same file size (12107 bytes), same decompressed length (67889),
//   every text run byte-identical, and the SAME SET of content streams —
//   with two of them written to the file in the opposite order.
//
// So the renderer emits page content streams in completion order rather than
// page order, and under load two can finish either way round. The document is
// identical: a PDF's page objects reference their streams by object id, so
// where those streams sit in the file is not a property any reader can observe.
// Nothing was wrong in production, and nothing was wrong with the recorded
// goldens either — the gate was pinning a property that does not exist.
//
// This is NOT the re-baselining the ticket forbade. That warning was against
// re-recording a hash to make the failure go away, which picks one of two
// outputs arbitrarily and keeps the same failure rate. This stops the two
// outputs being different in the first place, because they are the same
// document. The goldens are re-recorded as a CONSEQUENCE of changing what is
// hashed, in the same commit that explains why.
//
// What is still caught: any change to the text a customer reads. The defect
// this gate was built for — an internal authoring annotation ("Draft template —
// have a solicitor review before use") reaching customer-facing output — is
// text, and text is compared in full. So are the page and font dictionaries,
// with only their object NUMBERS neutralised, so a changed page size or font
// size still fails.
export const normalizePdfBytes = (buffer: Buffer): string => {
  const raw = buffer
    .toString("latin1")
    .replace(/\(D:\d{14}[+\-Z][^)]*\)/g, "(D:FIXED)")
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<0> <0>]");

  // Lift the stream bodies out and compare them as a SET. This is the line that
  // fixes the flake: the bodies are identical, only their order moves.
  const bodies: string[] = [];
  const skeleton = raw
    .replace(/stream\r?\n([\s\S]*?)\r?\nendstream/g, (_match, body: string) => {
      bodies.push(body);
      return "stream\nSTREAM\nendstream";
    })
    // Everything below moves *with* the streams and therefore cannot be part of
    // the comparison: object numbers and the references to them, the per-object
    // /Length, and the xref offsets and trailer that index them all by position.
    .replace(/\d+ 0 obj/g, "N 0 obj")
    .replace(/\d+ 0 R/g, "N 0 R")
    .replace(/\/Length \d+/g, "/Length N")
    .replace(/\/Size \d+/g, "/Size N")
    .replace(/^\d{10} \d{5} [nf]\s*$/gm, "OFFSET")
    .replace(/startxref\s+\d+/g, "startxref N");

  return [skeleton, ...bodies.sort()].join("\n--\n");
};
