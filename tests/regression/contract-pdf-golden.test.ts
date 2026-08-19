// Golden-render gate for the contract PDF.
//
// The quote PDF has had one of these since its renderer was split; the
// contract PDF had none, which is why an internal authoring annotation ("Use
// for: …", "Draft template — have a solicitor review before use") could sit in
// customer-facing output through several releases without any gate noticing.
//
// It pins the *bytes*: it stubs the admin client with one fixture row per
// template key, renders through the public entry point, and compares a hash of
// the normalised output against a committed golden. One case per key, because
// the leak this exists to catch was per-template.
//
// Regenerate deliberately and never casually:
//   UPDATE_CONTRACT_PDF_GOLDEN=1 npx vitest run tests/regression/contract-pdf-golden.test.ts
// A diff here means the customer-facing contract changed. If that was
// intended, re-baseline in its own commit so the change is reviewable on its
// own.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePdfBytes } from "../helpers/quote-pdf-fixtures";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractVariables } from "@/lib/schemas/contract";

// Every variable the templates reference, all populated, so the gate covers
// each {{#section}} branch in its rendered-on state. A blank here would silently
// shrink the document the golden is pinning.
const VARIABLES = {
  business_name: "Fenland Electrical Ltd",
  trading_name: "Fenland Electrical",
  business_structure: "a private limited company",
  company_number: "09876543",
  registered_address: "14 Mill Road, Wisbech, PE13 1AA",
  business_contact: "01945 000111",
  business_email: "meg@fenland-electrical.co.uk",
  business_phone: "01945 000111",
  trade: "Electrician",
  certifications: "NICEIC Approved Contractor",
  insurer_name: "Zurich",
  public_liability_cover: "£2,000,000",
  insurance_disclosed: "yes",
  client_name: "Mr A Barrett",
  client_address: "3 Elm Close, March, PE15 8QT",
  client_contact: "07700 900123",
  site_address: "3 Elm Close, March, PE15 8QT",
  quote_reference: "A1B2C3D4",
  contract_date: "19 Aug 2026",
  scope_of_work: "Full rewire of a three-bed semi, including consumer unit replacement.",
  exclusions: "Redecoration after making good.",
  labour_cost: "£1,700.00",
  materials_cost: "£620.00",
  subtotal: "£2,320.00",
  vat_amount: "£464.00",
  vat_number: "GB123456789",
  vat_registered: "yes",
  total_price: "£2,784.00",
  deposit_amount: "£556.80",
  payment_schedule: "30% deposit, balance on completion.",
  default_payment_terms: "Payment due within 14 days of invoice",
  payment_methods: "Bank transfer",
  bank_details: "Fenland Electrical Ltd, sort code 04-00-04, account no. 12345678",
  materials_by: "the Contractor",
  materials_notes: "Cable and accessories to BS 7671.",
  start_date: "1 Sep 2026",
  estimated_duration: "5 working days",
  completion_date: "5 Sep 2026",
  access_arrangements: "Key collected from the neighbour at no. 5.",
  warranty_period: "12 months",
  building_regs_responsibility: "the Contractor",
  cancellation_start: "Yes",
  special_terms: "Parking permit to be provided by the Client.",
  governing_law: "England & Wales",
} as unknown as ContractVariables;

const GOLDEN_PATH = path.join(__dirname, "contract-pdf-golden.json");

const readGolden = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};

// Which contract row the stubbed admin client should serve for the next render.
let currentRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: currentRow, error: null }),
        }),
      }),
    }),
  }),
}));

const rowFor = (renderedBody: string): Record<string, unknown> => ({
  id: "c0ffee00-0000-4000-8000-000000000001",
  deposit_pct: 20,
  rendered_body: renderedBody,
  status: "signed",
  signer_name: "Mr A Barrett",
  signed_at: "2026-08-19T10:00:00.000Z",
  created_at: "2026-08-19T09:00:00.000Z",
  quote: {
    total: 2784,
    job: {
      customer: { name: "Mr A Barrett" },
      contractor: {
        company_name: "Fenland Electrical Ltd",
        company_number: "09876543",
        trade: "Electrician",
        vat_registered: true,
        vat_number: "GB123456789",
        branding: { brand_color: "#004225" },
      },
    },
  },
});

describe("contract PDF golden render", () => {
  beforeEach(() => {
    currentRow = null;
  });

  it("produces byte-identical output for every template", async () => {
    const { renderContractPdf } = await import("@/lib/pdf/render-contract");

    const hashes: Record<string, string> = {};
    for (const template of CONTRACT_TEMPLATES) {
      currentRow = rowFor(renderContractTemplate(template.body, VARIABLES));
      const buffer = await renderContractPdf("c0ffee00-0000-4000-8000-000000000001");
      expect(buffer, `${template.key} rendered nothing`).not.toBeNull();
      hashes[template.key] = createHash("sha256")
        .update(normalizePdfBytes(buffer as Buffer), "latin1")
        .digest("hex");
    }

    if (process.env.UPDATE_CONTRACT_PDF_GOLDEN === "1") {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(hashes, null, 2)}\n`);
    }

    const golden = readGolden();
    expect(
      Object.keys(golden).length,
      "no golden recorded — run with UPDATE_CONTRACT_PDF_GOLDEN=1 first",
    ).toBeGreaterThan(0);
    expect(hashes).toEqual(golden);
  }, 120_000);

  it("returns null when the contract row is absent", async () => {
    const { renderContractPdf } = await import("@/lib/pdf/render-contract");
    currentRow = null;
    await expect(renderContractPdf("missing")).resolves.toBeNull();
  });
});
