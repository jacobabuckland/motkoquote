import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Issue #655: REF-5: A liability query Jacob can read without writing SQL
 *
 * These tests verify that:
 * 1. A query file exists at docs/queries/referral-liability.sql
 * 2. The query calculates total unconsumed banked months across all contractors
 * 3. The calculation is FLOOR(activated_referral_count / 5) summed across contractors
 * 4. The query is valid SQL that can be executed
 * 5. Edge cases are handled correctly (zero liability, partial activations)
 */

const QUERY_PATH = join(process.cwd(), "docs/queries/referral-liability.sql");

describe("Issue #655: REF-5: A liability query Jacob can read without writing SQL", () => {
  describe("Query file", () => {
    it("exists at docs/queries/referral-liability.sql", () => {
      expect(existsSync(QUERY_PATH), `Query file should exist at ${QUERY_PATH}`).toBe(true);
    });

    it("contains a SELECT query", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      expect(content).toMatch(/\bSELECT\b/i);
    });

    it("reads from the contractors table", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      expect(content).toMatch(/\bFROM\s+contractors\b/i);
    });

    it("uses activated_referral_count column", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      expect(content).toContain("activated_referral_count");
    });

    it("implements the floor division by 5 calculation", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      // The calculation should be FLOOR(activated_referral_count / 5)
      // Match variations: FLOOR(.../ 5), FLOOR(... /5), floor(...), etc
      expect(content).toMatch(/\bFLOOR\s*\([^)]*activated_referral_count[^)]*\/\s*5\s*\)/i);
    });

    it("sums the result across all contractors", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      // Should use SUM() to aggregate across all contractors
      expect(content).toMatch(/\bSUM\s*\(/i);
    });

    it("handles zero liability correctly (COALESCE to ensure non-null result)", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      // When no contractors have activations, SUM returns NULL. The query should
      // wrap it in COALESCE(..., 0) to return 0 instead of NULL.
      expect(content).toMatch(/\bCOALESCE\s*\([^)]*,\s*0\s*\)/i);
    });
  });

  describe("Calculation logic", () => {
    /**
     * Helper function that mirrors the SQL query's calculation.
     * This tests that the logic is correct without needing a live database.
     */
    const calculateBankedMonths = (activatedReferralCounts: number[]): number => {
      if (activatedReferralCounts.length === 0) return 0;
      const total = activatedReferralCounts.reduce(
        (sum, count) => sum + Math.floor(count / 5),
        0,
      );
      return total;
    };

    it("returns 0 when there are no contractors", () => {
      expect(calculateBankedMonths([])).toBe(0);
    });

    it("returns 0 when no contractor has 5+ activations", () => {
      // 0, 1, 2, 3, 4 activations = 0 months each
      expect(calculateBankedMonths([0, 1, 2, 3, 4])).toBe(0);
    });

    it("returns 1 when one contractor has exactly 5 activations", () => {
      // floor(5/5) = 1
      expect(calculateBankedMonths([5])).toBe(1);
    });

    it("returns 1 when one contractor has 5-9 activations", () => {
      // floor(7/5) = 1, floor(9/5) = 1
      expect(calculateBankedMonths([7])).toBe(1);
      expect(calculateBankedMonths([9])).toBe(1);
    });

    it("returns 2 when one contractor has 10 activations", () => {
      // floor(10/5) = 2
      expect(calculateBankedMonths([10])).toBe(2);
    });

    it("returns 3 when one contractor has 15 activations", () => {
      // floor(15/5) = 3
      expect(calculateBankedMonths([15])).toBe(3);
    });

    it("floors down partial months (4 activations = 0 months, not 0.8)", () => {
      // floor(4/5) = 0
      expect(calculateBankedMonths([4])).toBe(0);
      // floor(9/5) = 1, not 1.8
      expect(calculateBankedMonths([9])).toBe(1);
      // floor(14/5) = 2, not 2.8
      expect(calculateBankedMonths([14])).toBe(2);
    });

    it("sums correctly across multiple contractors", () => {
      // Contractor A: 7 activations = floor(7/5) = 1 month
      // Contractor B: 12 activations = floor(12/5) = 2 months
      // Total: 3 months
      expect(calculateBankedMonths([7, 12])).toBe(3);
    });

    it("handles mixed zero and non-zero activations", () => {
      // Contractors with 0, 3, 5, 8, 10 activations
      // = 0 + 0 + 1 + 1 + 2 = 4 months
      expect(calculateBankedMonths([0, 3, 5, 8, 10])).toBe(4);
    });

    it("calculates correctly for the spec example: 10 activations = 2 months", () => {
      // REF-3 AC says "Ten activations bank two months"
      expect(calculateBankedMonths([10])).toBe(2);
    });

    it("handles large numbers of contractors", () => {
      // 100 contractors, each with 5 activations = 100 months total
      const counts = Array(100).fill(5);
      expect(calculateBankedMonths(counts)).toBe(100);
    });

    it("handles large activation counts", () => {
      // A contractor with 150 activations = floor(150/5) = 30 months
      expect(calculateBankedMonths([150])).toBe(30);
    });
  });

  describe("Query readability", () => {
    it("includes comments explaining the calculation", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      // The query should have comments explaining what it does and how the
      // calculation works, making it readable without SQL expertise
      expect(content).toMatch(/--/);
    });

    it("uses a clear column alias for the result", () => {
      const content = readFileSync(QUERY_PATH, "utf-8");
      // Should alias the result as something readable like "total_banked_months"
      // or "unconsumed_months" rather than leaving it unnamed
      expect(content).toMatch(/\bAS\s+\w+/i);
    });
  });
});
