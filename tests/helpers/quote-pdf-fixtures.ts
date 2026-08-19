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
export const QUOTE_PDF_FIXTURES: QuotePdfFixture[] = [
  {
    key: "vat-registered-with-logo",
    quoteId: "aaaaaaaa-1111-4111-8111-111111111111",
    row: {
      created_at: "2026-03-14T09:30:00.000Z",
      line_items_json: LINE_ITEMS,
      job: {
        extracted_json: { job_type: "Full rewire" },
        sow_json: null,
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
          vat_number: "GB123456789",
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
        sow_json: null,
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
        sow_json: null,
        customer: {
          name: "Dawn Whitaker",
          contact: { email: "dawn@example.com", address: "4 The Green, Dereham" },
        },
        contractor: {
          company_name: "Fenland Plastering",
          company_number: "11223344",
          trade: "Plasterer",
          vat_registered: true,
          vat_number: "GB998877665",
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
        sow_json: null,
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
        extracted_json: { job_type: "Kitchen rewire" },
        sow_json: {
          job_type: "rewire",
          rooms: [
            { name: "Kitchen", dimensions: "4m x 3m", work_items: ["Install 6 double sockets", "Install cooker circuit"] },
            { name: "Utility room", dimensions: undefined, work_items: ["Install 2 double sockets"] },
          ],
          materials_mentioned: ["2.5mm cable", "sockets"],
          access_issues: "Occupied property, work 9am-5pm only",
          existing_conditions: "Old rubber cable throughout",
          timeline: "3 days",
          labour_plan: { people_count: 2, duration_days: 3, crew_description: "Me and apprentice" },
          deadline: null,
          materials_supply: { contractor_supplied: ["cable"], customer_supplied: ["consumer unit"] },
          agreed_costs: null,
          pricing: null,
          inclusions: ["Making good", "Testing and certification"],
          exclusions: ["Decorating", "Moving furniture"],
          additional_items: ["Haul rubbish"],
          assumptions_and_unknowns: [{ description: "Earthing adequate", treatment: "assumed_ok" }],
          customer_name: "Test Customer",
          site_address: "123 Test St",
          customer_phone: undefined,
          customer_email: undefined,
          complete: true,
          next_question: undefined,
          overview_narrative: "Complete rewire of kitchen and utility room",
          reclassification_count: 0,
          used_generic_fallback: false,
          wrap_incomplete: false,
          unasked_required: [],
        },
        customer: {
          name: "Emma Martinez",
          contact: { email: "emma@example.com", phone: "07700 900321" },
        },
        contractor: {
          company_name: "Fenland Electrical",
          company_number: "12345678",
          trade: "Electrician",
          vat_registered: true,
          vat_number: "GB555444333",
          branding: { brand_color: "#1e40af" },
        },
      },
    },
  },
];

// A rendered PDF carries two fields that change on every render regardless of
// input: the /CreationDate timestamp and the /ID nonce (an MD5 over content +
// time). Both are fixed-width, so blanking them leaves every xref byte offset
// intact and the rest of the file is compared verbatim. Without this, no
// golden gate over this renderer can ever pass — not even against itself.
export const normalizePdfBytes = (buffer: Buffer): string =>
  buffer
    .toString("latin1")
    .replace(/\(D:\d{14}[+\-Z][^)]*\)/g, "(D:FIXED)")
    .replace(/\/ID \[<[0-9a-fA-F]+> <[0-9a-fA-F]+>\]/g, "/ID [<0> <0>]");
