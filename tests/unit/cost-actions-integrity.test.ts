import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Unit tests verifying money integrity in cost actions (Issue #244)
 *
 * The spec requires: "A unit test asserts no float arithmetic exists in the
 * cost creation/update path (reject calculations like `amount * 0.20`, require
 * `Math.round(amount * 20 / 100)`)."
 *
 * This test verifies that all amounts are handled as integers (pence) and no
 * float arithmetic is performed on money values in the cost actions module.
 */

describe("Issue #244: Money integrity - no float arithmetic in cost actions", () => {
  it("cost-actions module contains no float arithmetic on money", () => {
    // Read the cost-actions.ts source code
    const costActionsPath = join(
      process.cwd(),
      "src/app/jobs/[id]/cost-actions.ts"
    );
    const sourceCode = readFileSync(costActionsPath, "utf-8");

    // Pattern 1: Reject multiplication by decimal (e.g., amount * 0.20)
    const floatMultiplyPattern = /\b(amount|vat|net|gross|total)\w*\s*\*\s*0\.\d+/i;
    expect(sourceCode).not.toMatch(floatMultiplyPattern);

    // Pattern 2: Reject division creating decimals without rounding
    // (e.g., amount / 1.20 without Math.round)
    const floatDividePattern = /\b(amount|vat|net|gross|total)\w*\s*\/\s*\d+\.\d+(?!\s*\))/i;
    expect(sourceCode).not.toMatch(floatDividePattern);

    // Pattern 3: Reject parseFloat on money values
    const parseFloatPattern = /parseFloat\s*\(\s*(amount|vat|net|gross|total)/i;
    expect(sourceCode).not.toMatch(parseFloatPattern);

    // Pattern 4: Reject Number() with division
    const numberWithFloatPattern = /Number\s*\(\s*[^)]*\s*\/\s*\d+\.\d+/i;
    expect(sourceCode).not.toMatch(numberWithFloatPattern);
  });

  it("cost-actions module passes amounts through without calculation", () => {
    // Read the cost-actions.ts source code
    const costActionsPath = join(
      process.cwd(),
      "src/app/jobs/[id]/cost-actions.ts"
    );
    const sourceCode = readFileSync(costActionsPath, "utf-8");

    // Verify amounts are passed straight through from schema to database
    // Should contain patterns like:
    // amount_net: parsed.data.amountNet
    // vat_amount: parsed.data.vatAmount

    expect(sourceCode).toContain("amount_net: parsed.data.amountNet");
    expect(sourceCode).toContain("vat_amount: parsed.data.vatAmount");

    // Verify no arithmetic operations on amount fields
    // The amounts should only be simple assignments, not calculations
    const arithmeticOnAmount = /amount_net:\s*\d+\s*[\+\-\*\/]|amount_net:\s*Math\./;
    expect(sourceCode).not.toMatch(arithmeticOnAmount);
  });

  it("schemas enforce integer types for money amounts", async () => {
    // Import the schemas
    const schemas = await import("@/lib/schemas/job-cost");

    // Parse a valid input with integer amounts
    const validInput = {
      jobId: "123e4567-e89b-12d3-a456-426614174000", // Valid UUID
      description: "Test cost",
      amountNet: 50000, // Integer pence
      vatAmount: 10000, // Integer pence
      vatTreatment: "standard" as const,
      category: "materials" as const,
      incurredOn: "2026-08-15",
      source: "manual" as const,
      paid: false,
    };

    const result = schemas.createJobCostSchema.safeParse(validInput);
    expect(result.success).toBe(true);

    if (result.success) {
      // Amounts should be integers
      expect(Number.isInteger(result.data.amountNet)).toBe(true);
      expect(result.data.vatAmount === null || result.data.vatAmount === undefined || Number.isInteger(result.data.vatAmount)).toBe(true);
    }
  });

  it("schemas should reject float amounts (if validation exists)", async () => {
    // This test documents expected behavior - if the schema validates
    // that amounts are integers, a float should be rejected.
    // If not validated at schema level, it's still caught at database level
    // (column type is int, not numeric).

    const schemas = await import("@/lib/schemas/job-cost");

    const invalidInput = {
      jobId: "123e4567-e89b-12d3-a456-426614174000",
      description: "Test cost",
      amountNet: 500.50, // Float pounds - should be rejected
      vatTreatment: "standard" as const,
      category: "materials" as const,
      incurredOn: "2026-08-15",
      source: "manual" as const,
      paid: false,
    };

    const result = schemas.createJobCostSchema.safeParse(invalidInput);

    // The schema enforces integer type, so this should fail
    expect(result.success).toBe(false);
    if (!result.success) {
      // Error should mention that amount must be integer
      expect(result.error.issues.some(i => i.message.includes("integer") || i.message.includes("pence"))).toBe(true);
    }
  });

  it("documents the pence convention in the migration", () => {
    // Read the migration file
    const migrationPath = join(
      process.cwd(),
      "supabase/migrations/00000000000041_job_costs_counterparties.sql"
    );
    const migration = readFileSync(migrationPath, "utf-8");

    // Verify the migration documents the pence convention
    expect(migration).toContain("integer pence");

    // Verify amount columns are defined as int type (not numeric or decimal)
    expect(migration).toMatch(/amount_net\s+int\b/);
    expect(migration).toMatch(/vat_amount\s+int\b/);
  });

  it("no arithmetic operations exist in cost-actions module", () => {
    // This is a code inspection test that verifies amounts pass through
    // without any mathematical operations
    const costActionsPath = join(
      process.cwd(),
      "src/app/jobs/[id]/cost-actions.ts"
    );
    const sourceCode = readFileSync(costActionsPath, "utf-8");

    // Count arithmetic operators involving amount-like variables
    // This is a simple check - in a real scenario, we'd use AST parsing
    const arithmeticPattern = /(amount|vat|net|gross|total)\w*\s*[\+\-\*\/]\s*\d/i;
    const matches = sourceCode.match(arithmeticPattern);

    // Should have no arithmetic on amount variables
    expect(matches).toBeNull();
  });
});
