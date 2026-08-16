import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Checker rule (Batch 2 — money integrity): no client-supplied monetary value
// may reach a charge or invoice write. Amounts must be derived server-side from
// stored records (the quote total, the contract deposit, the invoices already
// raised), never accepted from the request body.
const root = (p: string) => join(process.cwd(), p);

describe("invoice amounts are server-derived", () => {
  const src = readFileSync(root("src/app/dashboard/actions.ts"), "utf8");

  it("the createInvoice zod schema does not accept a client amount", () => {
    // Isolate just the z.object({...}) literal so an `amount` in a nearby type
    // can't mask a regression that re-adds a client-supplied figure.
    const start = src.indexOf("const createInvoiceSchema");
    const schema = src.slice(start, src.indexOf("});", start) + 3);
    expect(schema).not.toMatch(/\bamount\b/);
    expect(schema).not.toMatch(/\btotal\b/);
    expect(schema).not.toMatch(/\bpennies\b/);
  });

  it("createInvoice derives the amount via deriveInvoiceAmount", () => {
    expect(src).toContain("deriveInvoiceAmount(");
  });
});

describe("pay-by-bank charge amount is server-derived", () => {
  const src = readFileSync(
    root("src/app/api/stripe/create-payment-intent/route.ts"),
    "utf8",
  );

  it("only reads invoiceId from the request body — never an amount", () => {
    const parsed = src.slice(
      src.indexOf("await request.json()"),
      src.indexOf("await request.json()") + 200,
    );
    expect(parsed).not.toMatch(/amount/i);
  });

  it("charges the amount loaded from the invoice record", () => {
    expect(src).toMatch(/amountPennies\s*=\s*Math\.round\(invoice\.amount/);
  });
});
