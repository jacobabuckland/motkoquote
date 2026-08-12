import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Issue #193: Payments migration inventory", () => {
  const inventoryPath = resolve(
    process.cwd(),
    "docs/payments-migration-inventory.md",
  );

  it("creates the inventory document", () => {
    const content = readFileSync(inventoryPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("contains all five required sections", () => {
    const content = readFileSync(inventoryPath, "utf8");

    // Check for the five main sections by heading
    expect(content).toMatch(/^##?\s+TrueLayer surface area/im);
    expect(content).toMatch(/^##?\s+Legacy Stripe.*classification/im);
    expect(content).toMatch(/^##?\s+Data model surface/im);
    expect(content).toMatch(/^##?\s+Dependency map/im);
    expect(content).toMatch(
      /^##?\s+(In-flight|Historical).*payment.*count/im,
    );
  });

  it("lists exactly 7 TrueLayer environment variables", () => {
    const content = readFileSync(inventoryPath, "utf8");

    // The seven required env vars
    const requiredVars = [
      "TRUELAYER_CLIENT_ID",
      "TRUELAYER_CLIENT_SECRET",
      "TRUELAYER_ENV",
      "TRUELAYER_SIGNING_KID",
      "TRUELAYER_SIGNING_PRIVATE_KEY_B64",
      "TRUELAYER_MERCHANT_ACCOUNT_ID",
      "MOTKO_FEE_BENEFICIARY_NAME",
    ];

    for (const varName of requiredVars) {
      expect(content).toContain(varName);
    }
  });

  it("lists the core TrueLayer library files", () => {
    const content = readFileSync(inventoryPath, "utf8");

    const coreFiles = [
      "src/lib/truelayer.ts",
      "src/lib/truelayer-payments.ts",
      "src/lib/truelayer-vrp.ts",
    ];

    for (const file of coreFiles) {
      expect(content).toContain(file);
    }
  });

  it("lists the TrueLayer API routes", () => {
    const content = readFileSync(inventoryPath, "utf8");

    expect(content).toContain("/api/truelayer/create-payment");
    expect(content).toContain("/api/truelayer/webhook");
  });

  it("covers database columns from invoices, contractors, and fee_collections", () => {
    const content = readFileSync(inventoryPath, "utf8");

    // Invoice columns
    expect(content).toContain("truelayer_payment_id");
    expect(content).toContain("payment_method");

    // Contractor columns
    expect(content).toContain("fee_mandate_id");
    expect(content).toContain("fee_mandate_status");
    expect(content).toContain("fee_collection_status");

    // Fee collection columns
    expect(content).toContain("provider_collection_ref");
    expect(content).toContain("attempts");
    expect(content).toContain("last_attempt_at");
    expect(content).toContain("failure_reason");

    // Job columns
    expect(content).toContain("payment_provider_ref");
  });

  it("classifies legacy Stripe code into Reusable, Delete, and Replace", () => {
    const content = readFileSync(inventoryPath, "utf8");

    expect(content).toMatch(/reusable/i);
    expect(content).toMatch(/delete/i);
    expect(content).toMatch(/replace/i);
  });

  it("lists legacy Stripe database columns for deletion", () => {
    const content = readFileSync(inventoryPath, "utf8");

    const stripeColumns = [
      "stripe_payment_link_id",
      "stripe_payment_link_url",
      "stripe_invoice_id",
      "stripe_account_id",
      "stripe_charges_enabled",
      "stripe_payouts_enabled",
      "stripe_requirements_due",
    ];

    for (const col of stripeColumns) {
      expect(content).toContain(col);
    }
  });

  it("includes a dependency map naming at least four migration tickets", () => {
    const content = readFileSync(inventoryPath, "utf8");

    // Look for PAY-2, PAY-3, PAY-4, PAY-5 or similar ticket references
    expect(content).toMatch(/PAY-2/);
    expect(content).toMatch(/PAY-3/);
    expect(content).toMatch(/PAY-4/);
    expect(content).toMatch(/PAY-5/);
  });

  it("addresses in-flight payment counts or explicitly marks them unknown", () => {
    const content = readFileSync(inventoryPath, "utf8");

    // Must either provide a count or explicitly state it's unknown
    const hasCountOrUnknown =
      content.match(/unknown.*production.*query/i) !== null ||
      content.match(/\d+\s+(invoice|payment|collection)/i) !== null;

    expect(hasCountOrUnknown).toBe(true);
  });

  it("references migration #93 (idempotency fix)", () => {
    const content = readFileSync(inventoryPath, "utf8");
    expect(content).toMatch(/#93/);
  });

  it("references migration #99 (middleware allowlist)", () => {
    const content = readFileSync(inventoryPath, "utf8");
    expect(content).toMatch(/#99/);
  });

  it("documents the middleware PUBLIC_API_ROUTES entries for TrueLayer", () => {
    const content = readFileSync(inventoryPath, "utf8");

    expect(content).toMatch(/PUBLIC_API_ROUTES/i);
    expect(content).toContain("src/lib/supabase/middleware.ts");
  });
});
