// Fixtures for the SOW-PDF golden-render gate.
//
// These are the *stored row* shape `renderSowPdf(jobId)` selects — not the
// component's props — so the gate covers the row→props mapping as well as the
// document itself. Two cases:
//
//   1. full-featured: A SOW with assumptions (including a provisional sum),
//      customer-supplied materials, and all optional sections populated
//   2. no-assumptions: A SOW with no assumptions, proving the section is absent
//      rather than present-and-empty
//
// The logo is an inline data: URI (a 1x1 PNG) rather than a remote URL, so the
// render exercises the <Image> branch without a network fetch — a golden gate
// that depends on the internet is not a gate.

import type { SowState } from "@/lib/schemas/sow";
import { normalizePdfBytes as quoteNormalizePdfBytes } from "./quote-pdf-fixtures";

// Re-export the normalizePdfBytes helper from quote-pdf-fixtures since the
// normalization logic is identical for all PDFs.
export const normalizePdfBytes = quoteNormalizePdfBytes;

// 1x1 transparent PNG.
export const FIXTURE_LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export type SowPdfFixture = {
  key: string;
  jobId: string;
  row: unknown;
};

// A fixed job id per case: `reference` is derived from it (first 8 chars,
// uppercased), so it has to be stable for the hash to be.
export const SOW_PDF_FIXTURES: SowPdfFixture[] = [
  {
    key: "full-featured",
    jobId: "ffffffff-1111-4111-8111-111111111111",
    row: {
      sow_json: {
        job_type: "rewire",
        overview_narrative:
          "A full rewire of a three-bed semi, consumer unit included, over three working days.",
        rooms: [
          {
            name: "Kitchen",
            dimensions: "4m x 3m",
            work_items: ["Replace six sockets", "Move the cooker spur"],
          },
          { name: "Landing", dimensions: undefined, work_items: ["Two-way switch"] },
        ],
        additional_items: ["Haul the old cable away", "Install outside light"],
        existing_conditions: "Old rubber cable throughout.",
        access_issues: "No working before 9am. Dog must be secured.",
        inclusions: ["Making good the chases", "Clearing debris"],
        exclusions: ["Redecoration", "Plastering"],
        materials_mentioned: ["6mm twin and earth", "Consumer unit"],
        materials_supply: {
          contractor_supplied: ["Cable", "Sockets"],
          customer_supplied: ["Light fittings", "Consumer unit"],
        },
        assumptions_and_unknowns: [
          {
            description: "Soil stack condition unknown — may need replacement (provisional sum £450)",
            treatment: "provisional_sum",
          },
          {
            description: "Board thickness assumed standard 18mm",
            treatment: "assumed_ok",
          },
        ],
        labour_plan: { people_count: 2, duration_days: 3, crew_description: "me and Liam" },
        deadline: { quote_by: undefined, job_by: "End of March" },
        agreed_costs: null,
        pricing: { mode: "days", fixed_amount: null },
        timeline: "First fix: 2 days. Second fix: 1 day.",
        customer_name: "Luca Feser",
        site_address: "12 Norwich Road, Dereham, NR19 1AA",
        customer_phone: "07700 900123",
        customer_email: "luca@example.co.uk",
        complete: true,
        next_question: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
      } satisfies SowState,
      created_at: "2026-03-14T09:30:00.000Z",
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
        vat_number: "GB123456789",
        branding: { brand_color: "#004225", logo_url: FIXTURE_LOGO_DATA_URI },
      },
    },
  },
  {
    key: "no-assumptions",
    jobId: "aaaaaaaa-2222-4222-8222-222222222222",
    row: {
      sow_json: {
        job_type: "bathroom refit",
        overview_narrative: "Complete bathroom refit including new suite and tiling.",
        rooms: [
          {
            name: "Main bathroom",
            dimensions: "2.5m x 2m",
            work_items: ["Remove old suite", "Install new bath, toilet, sink", "Full wall tiling"],
          },
        ],
        additional_items: ["Install extractor fan"],
        existing_conditions: "Original 1970s suite in place.",
        access_issues: undefined,
        inclusions: ["All labour and materials", "Waste disposal"],
        exclusions: ["Electrical work", "Decorating"],
        materials_mentioned: ["White gloss tiles", "Chrome fixtures"],
        materials_supply: {
          contractor_supplied: ["Tiles", "Grout", "Adhesive"],
          customer_supplied: ["Bath", "Toilet", "Sink"],
        },
        assumptions_and_unknowns: [],
        labour_plan: { people_count: 1, duration_days: 5, crew_description: "myself" },
        deadline: null,
        agreed_costs: null,
        pricing: { mode: "fixed", fixed_amount: 2800 },
        timeline: undefined,
        customer_name: "Sam Okonkwo",
        site_address: "45 High Street, Norwich, NR1 3JE",
        customer_phone: "07700 900456",
        customer_email: undefined,
        complete: true,
        next_question: undefined,
        reclassification_count: 0,
        used_generic_fallback: false,
        wrap_incomplete: false,
        unasked_required: [],
        stated_prices: [],
        declined_slots: [],
      } satisfies SowState,
      created_at: "2026-03-14T09:30:00.000Z",
      customer: {
        name: "Sam Okonkwo",
        contact: { phone: "07700 900456", address: "45 High Street, Norwich, NR1 3JE" },
      },
      contractor: {
        company_name: "S. Hartley Plumbing",
        company_number: null,
        trade: "Plumber",
        vat_number: null,
        branding: {},
      },
    },
  },
];
