// Golden-render gate for the Statement of Work PDF.
//
// This path renders live SOW documents that contractors send to customers. The
// gate pins the *bytes*: it stubs the admin client with fixture rows, renders
// through the public entry point, and compares a hash of the normalised output
// against a committed golden.
//
// Regenerate deliberately and never casually:
//   UPDATE_SOW_PDF_GOLDEN=1 npx vitest run tests/regression/sow-pdf-golden.test.ts
// A diff here means the customer-facing document changed. If that was intended,
// re-baseline in its own commit so the change is reviewable on its own.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SOW_PDF_FIXTURES,
  normalizePdfBytes,
  type SowPdfFixture,
} from "../helpers/sow-pdf-fixtures";

// Which fixture row the stubbed admin client should serve for the next render.
let currentFixture: SowPdfFixture | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: currentFixture?.row ?? null, error: null }),
        }),
      }),
    }),
  }),
}));

const GOLDEN_PATH = path.join(__dirname, "sow-pdf-golden.json");

const readGolden = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};

describe("SOW PDF golden render", () => {
  beforeEach(() => {
    currentFixture = null;
  });

  it("produces byte-identical output for every fixture case", async () => {
    const { renderSowPdf } = await import("@/lib/pdf/render-sow");

    const hashes: Record<string, string> = {};
    for (const fixture of SOW_PDF_FIXTURES) {
      currentFixture = fixture;
      const buffer = await renderSowPdf(fixture.jobId);
      // Assert the type rather than casting to it. `buffer as Buffer` below
      // silences the compiler without making the value real, so without this
      // line a renderSowPdf that returned a string, a Uint8Array or a promise
      // would still typecheck and would still produce a stable hash — the
      // golden would pin the wrong thing and never say so.
      expect(buffer, `${fixture.key} rendered nothing`).toBeInstanceOf(Buffer);
      hashes[fixture.key] = createHash("sha256")
        .update(normalizePdfBytes(buffer as Buffer), "latin1")
        .digest("hex");
    }

    if (process.env.UPDATE_SOW_PDF_GOLDEN === "1") {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(hashes, null, 2)}\n`);
    }

    const golden = readGolden();
    expect(
      Object.keys(golden).length,
      "no golden recorded — run with UPDATE_SOW_PDF_GOLDEN=1 first",
    ).toBeGreaterThan(0);
    expect(hashes).toEqual(golden);
  }, 60_000);

  // The full-featured fixture exercises assumptions_and_unknowns, customer_supplied
  // materials, and provisional_sum — all optional sections that must render when
  // present.
  it("full-featured fixture has assumptions with provisional sum and customer-supplied materials", () => {
    const fullFeatured = SOW_PDF_FIXTURES.find((f) => f.key === "full-featured");
    expect(fullFeatured).toBeDefined();
    const sow = (fullFeatured!.row as { sow_json: { assumptions_and_unknowns?: unknown[]; materials_supply?: { customer_supplied?: string[] } } }).sow_json;
    expect(sow.assumptions_and_unknowns).toBeDefined();
    expect(sow.assumptions_and_unknowns!.length).toBeGreaterThan(0);
    // One assumption has a provisional_sum
    expect(JSON.stringify(sow.assumptions_and_unknowns)).toContain("provisional_sum");
    expect(sow.materials_supply?.customer_supplied).toBeDefined();
    expect(sow.materials_supply!.customer_supplied!.length).toBeGreaterThan(0);
  });

  // The no-assumptions fixture proves the Assumptions section is absent when
  // there are no assumptions, not present-and-empty.
  it("no-assumptions fixture has empty assumptions_and_unknowns array", () => {
    const noAssumptions = SOW_PDF_FIXTURES.find((f) => f.key === "no-assumptions");
    expect(noAssumptions).toBeDefined();
    const sow = (noAssumptions!.row as { sow_json: { assumptions_and_unknowns: unknown[] } }).sow_json;
    expect(sow.assumptions_and_unknowns).toEqual([]);
  });

  it("returns null when the job row is absent", async () => {
    const { renderSowPdf } = await import("@/lib/pdf/render-sow");
    currentFixture = null;
    await expect(renderSowPdf("missing")).resolves.toBeNull();
  });

  it("returns null when the job has no sow_json", async () => {
    const { renderSowPdf } = await import("@/lib/pdf/render-sow");
    currentFixture = {
      key: "no-sow",
      jobId: "bbbbbbbb-3333-4333-8333-333333333333",
      row: {
        sow_json: null,
        created_at: "2026-03-14T09:30:00.000Z",
        customer: null,
        contractor: {
          company_name: "Test Contractor",
          company_number: null,
          trade: "Plumber",
          vat_number: null,
          branding: {},
        },
      },
    };
    await expect(renderSowPdf("bbbbbbbb-3333-4333-8333-333333333333")).resolves.toBeNull();
  });
});
