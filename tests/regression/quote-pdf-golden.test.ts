// Golden-render gate for the quote PDF.
//
// This path renders live financial documents. `renderQuotePdf` is being split
// into a pure `renderQuotePdfFromPayload` (which the guest flow renders in the
// browser) plus a thin row-loading wrapper, and nothing about the produced
// document may change in the process. The gate pins the *bytes*: it stubs the
// admin client with three fixture rows, renders through the public entry point,
// and compares a hash of the normalised output against a committed golden.
//
// Regenerate deliberately and never casually:
//   UPDATE_QUOTE_PDF_GOLDEN=1 npx vitest run tests/regression/quote-pdf-golden.test.ts
// A diff here means the customer-facing document changed. If that was intended,
// re-baseline in its own commit so the change is reviewable on its own.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUOTE_PDF_FIXTURES,
  normalizePdfBytes,
  type QuotePdfFixture,
} from "../helpers/quote-pdf-fixtures";

// Which fixture row the stubbed admin client should serve for the next render.
let currentFixture: QuotePdfFixture | null = null;

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

const GOLDEN_PATH = path.join(__dirname, "quote-pdf-golden.json");

const readGolden = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
};

describe("quote PDF golden render", () => {
  beforeEach(() => {
    currentFixture = null;
  });

  it("produces byte-identical output for every fixture case", async () => {
    const { renderQuotePdf } = await import("@/lib/pdf/render-quote");

    const hashes: Record<string, string> = {};
    for (const fixture of QUOTE_PDF_FIXTURES) {
      currentFixture = fixture;
      const buffer = await renderQuotePdf(fixture.quoteId);
      expect(buffer, `${fixture.key} rendered nothing`).not.toBeNull();
      hashes[fixture.key] = createHash("sha256")
        .update(normalizePdfBytes(buffer as Buffer), "latin1")
        .digest("hex");
    }

    if (process.env.UPDATE_QUOTE_PDF_GOLDEN === "1") {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(hashes, null, 2)}\n`);
    }

    const golden = readGolden();
    expect(
      Object.keys(golden).length,
      "no golden recorded — run with UPDATE_QUOTE_PDF_GOLDEN=1 first",
    ).toBeGreaterThan(0);
    expect(hashes).toEqual(golden);
  }, 60_000);

  it("returns null when the quote row is absent", async () => {
    const { renderQuotePdf } = await import("@/lib/pdf/render-quote");
    currentFixture = null;
    await expect(renderQuotePdf("missing")).resolves.toBeNull();
  });
});
