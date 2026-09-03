import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("DATA-1: contractors.is_internal flag", () => {
  const migrationPath = join(
    process.cwd(),
    "supabase/migrations/00000000000063_contractor_is_internal.sql",
  );

  it("migration file exists at the correct path", () => {
    expect(
      existsSync(migrationPath),
      "Migration 00000000000063_contractor_is_internal.sql must exist",
    ).toBe(true);
  });

  it("migration adds is_internal column with correct constraints", () => {
    const sql = readFileSync(migrationPath, "utf-8");

    // Must add the column to contractors table
    expect(sql).toMatch(/alter\s+table\s+contractors/i);
    expect(sql).toMatch(/add\s+column\s+is_internal/i);

    // Must be boolean type
    expect(sql).toMatch(/is_internal\s+boolean/i);

    // Must be not null with default false
    expect(sql).toMatch(/not\s+null/i);
    expect(sql).toMatch(/default\s+false/i);
  });

  it("migration is idempotent (safe to run multiple times)", () => {
    const sql = readFileSync(migrationPath, "utf-8");

    // Should use IF NOT EXISTS or similar guard
    // Common patterns: "IF NOT EXISTS", "ADD COLUMN IF NOT EXISTS", or
    // a DO block with existence check
    const hasIdempotencyGuard =
      /if\s+not\s+exists/i.test(sql) ||
      /add\s+column\s+if\s+not\s+exists/i.test(sql) ||
      (/do\s+\$\$/i.test(sql) && /if\s+not\s+exists/i.test(sql));

    expect(
      hasIdempotencyGuard,
      "Migration should be idempotent using IF NOT EXISTS or equivalent guard",
    ).toBe(true);
  });

  it("migration does not modify existing rows", () => {
    const sql = readFileSync(migrationPath, "utf-8");

    // Should NOT contain UPDATE statements that would change existing contractor rows
    // Allowed: UPDATE to set the column on specific identified accounts AFTER the column exists
    // Not allowed: bulk UPDATE that reclassifies based on email domain or other heuristic
    const lines = sql.split("\n");
    const alterTableLine = lines.findIndex((line) =>
      /alter\s+table\s+contractors\s+add\s+column/i.test(line),
    );

    // There should be an ALTER TABLE ADD COLUMN, and it should rely on DEFAULT
    // rather than a separate UPDATE
    expect(alterTableLine).toBeGreaterThan(-1);

    // Check that any UPDATE statements are explicit (by ID), not bulk reclassifications
    const updateStatements = lines.filter((line) => /^\s*update\s+contractors/i.test(line));

    for (const stmt of updateStatements) {
      // If there are UPDATEs, they must be by specific ID (UUID pattern)
      // or explicitly marked as manual test-account marking
      const isBySpecificId = /where\s+id\s*=\s*'[0-9a-f-]{36}'/i.test(stmt);
      const isExplicitManualMark = /is_internal\s*=\s*true/i.test(stmt);

      if (!isBySpecificId && !isExplicitManualMark) {
        expect(
          false,
          `UPDATE statement appears to be a bulk reclassification, not an explicit manual mark: ${stmt}`,
        ).toBe(true);
      }
    }
  });

  it("migration number is 063 (one above current highest 062)", () => {
    const filename = migrationPath.split("/").pop();
    expect(filename).toMatch(/^00000000000063_/);
  });

  it("default value is false, ensuring no account is silently marked internal", () => {
    const sql = readFileSync(migrationPath, "utf-8");

    // Explicitly verify default is false, not true
    expect(sql).toMatch(/default\s+false/i);
    expect(sql).not.toMatch(/default\s+true/i);
  });

  it("column name is is_internal (not internal, not is_test, not test_account)", () => {
    const sql = readFileSync(migrationPath, "utf-8");

    // Must use the exact name is_internal
    expect(sql).toMatch(/is_internal\s+boolean/i);

    // Should NOT use alternative names
    expect(sql).not.toMatch(/\badd\s+column\s+internal\s+boolean/i);
    expect(sql).not.toMatch(/\badd\s+column\s+is_test\s+boolean/i);
    expect(sql).not.toMatch(/\badd\s+column\s+test_account\s+boolean/i);
  });
});
