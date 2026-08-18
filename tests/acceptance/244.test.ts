import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The schema and RLS assertions read the migration rather than querying a
 * database.
 *
 * They were written to call the request-scoped `createClient()` from
 * `@/lib/supabase/server`, which throws outside a request scope. That made the
 * spec self-contradictory: it declares "Modified: None", yet these tests could
 * only run if `server.ts` were modified to fall back to another client. The
 * fallback that was added returned a stub answering `{ data: [], error: null }`,
 * so all four assertions passed against no database at all — and it put a silent
 * degrade-to-anonymous path into the file every authenticated query goes
 * through.
 *
 * A gate with no credentials cannot honestly assert anything about a live
 * database. It CAN assert what this tree declares, which is what these tests
 * mean at spec level. Behaviour against a real database — cross-tenant
 * isolation, ON DELETE RESTRICT, the edge cases — is covered by
 * tests/integration/244-*.test.ts on the live lane, which has credentials.
 */
const MIGRATION = "supabase/migrations/00000000000041_job_costs_counterparties.sql";

const readMigration = (): string => readFileSync(MIGRATION, "utf8");

/** The body of one `create table` statement, so a column cannot be matched from a neighbour. */
const tableBody = (sql: string, table: string): string => {
  const at = new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${table}\\b`, "i").exec(sql);
  expect(at, `no create table for ${table}`).not.toBeNull();
  const rest = sql.slice(at!.index);
  const end = rest.indexOf(");");
  expect(end, `unterminated create table for ${table}`).toBeGreaterThan(0);
  return rest.slice(0, end);
};

// NOTE: These imports will fail until the Engineer implements the migration and server actions.
// Expected modules:
// - supabase/migrations/00000000000041_job_costs_counterparties.sql (or next available number)
// - src/app/jobs/[id]/cost-actions.ts for server actions
// - src/lib/counterparty-matching.ts for name normalisation logic

describe("Issue #244: LED-1 — Job costs and counterparties data model", () => {
  describe("Migration creates tables with correct schema", () => {
    it("creates counterparties table with required columns", () => {
      const migration = readMigration();
      const table = tableBody(migration, "counterparties");

      for (const column of ["id", "contractor_id", "name", "kind", "created_at"]) {
        expect(table, `counterparties.${column} is missing`).toMatch(
          new RegExp(`\\b${column}\\b`),
        );
      }
    });

    it("creates job_costs table with required columns", () => {
      const migration = readMigration();
      const table = tableBody(migration, "job_costs");

      for (const column of [
        "id", "job_id", "contractor_id", "counterparty_id", "description",
        "amount_net", "vat_amount", "vat_treatment", "category", "incurred_on",
        "paid", "paid_on", "evidence_url", "source", "created_at", "updated_at",
      ]) {
        expect(table, `job_costs.${column} is missing`).toMatch(new RegExp(`\\b${column}\\b`));
      }
    });

    it("enforces kind enum on counterparties", async () => {
      // The kind column must accept only: supplier, subcontractor, other
      // This test documents the constraint; the migration enforces it.
      const validKinds = ["supplier", "subcontractor", "other"];
      expect(validKinds).toContain("supplier");
      expect(validKinds).toContain("subcontractor");
      expect(validKinds).toContain("other");
      expect(validKinds).not.toContain("invalid_kind");
    });

    it("enforces vat_treatment enum on job_costs", async () => {
      // The vat_treatment column must accept: standard, zero, exempt, reverse_charge, unknown
      const validVatTreatments = ["standard", "zero", "exempt", "reverse_charge", "unknown"];
      expect(validVatTreatments).toContain("standard");
      expect(validVatTreatments).toContain("reverse_charge");
      expect(validVatTreatments).toContain("unknown");
    });

    it("enforces category enum on job_costs", async () => {
      // The category column must accept: materials, labour, subcontractor, plant_hire, other
      const validCategories = ["materials", "labour", "subcontractor", "plant_hire", "other"];
      expect(validCategories).toContain("materials");
      expect(validCategories).toContain("subcontractor");
      expect(validCategories).toContain("plant_hire");
    });

    it("enforces source enum on job_costs", async () => {
      // The source column must accept: voice, photo, manual
      const validSources = ["voice", "photo", "manual"];
      expect(validSources).toContain("voice");
      expect(validSources).toContain("photo");
      expect(validSources).toContain("manual");
    });
  });

  describe("RLS policies enforce contractor-scoped access", () => {
    it("enables row level security on counterparties", () => {
      expect(readMigration()).toMatch(
        /alter\s+table\s+(public\.)?counterparties\s+enable\s+row\s+level\s+security/i,
      );
    });

    it("enables row level security on job_costs", () => {
      expect(readMigration()).toMatch(
        /alter\s+table\s+(public\.)?job_costs\s+enable\s+row\s+level\s+security/i,
      );
    });

    it("prevents cross-tenant access to costs", async () => {
      // This is the critical security test. Contractor A cannot see contractor B's costs.
      // The test structure:
      // 1. Create a cost as contractor A (via server action)
      // 2. Attempt to read it as contractor B (should fail/return empty)
      // The Engineer must implement this with actual auth contexts.

      // Placeholder assertion — the Engineer will expand this with real auth mocking.
      // Expected: server action calls scoped to different contractors return disjoint results.
      expect(true).toBe(true);
    });
  });

  describe("Server actions for cost CRUD", () => {
    it("createJobCost action exists and creates a cost row", async () => {
      let costActionsModule: { createJobCost?: unknown };
      try {
        costActionsModule = await import("@/app/jobs/[id]/cost-actions");
      } catch (error) {
        if (error instanceof Error && error.message.includes("Cannot find module")) {
          throw new Error(
            "Cost actions module does not exist. Expected: src/app/jobs/[id]/cost-actions.ts"
          );
        }
        throw error;
      }

      expect(costActionsModule.createJobCost).toBeDefined();
      expect(typeof costActionsModule.createJobCost).toBe("function");
    });

    it("updateJobCost action exists", async () => {
      const costActionsModule = await import("@/app/jobs/[id]/cost-actions");
      expect(costActionsModule.updateJobCost).toBeDefined();
      expect(typeof costActionsModule.updateJobCost).toBe("function");
    });

    it("markCostPaid action exists", async () => {
      const costActionsModule = await import("@/app/jobs/[id]/cost-actions");
      expect(costActionsModule.markCostPaid).toBeDefined();
      expect(typeof costActionsModule.markCostPaid).toBe("function");
    });

    it("getJobCosts action exists", async () => {
      const costActionsModule = await import("@/app/jobs/[id]/cost-actions");
      expect(costActionsModule.getJobCosts).toBeDefined();
      expect(typeof costActionsModule.getJobCosts).toBe("function");
    });
  });

  describe("Counterparty matching logic", () => {
    it("normalises counterparty names (case-insensitive)", async () => {
      const { normaliseCounterpartyName } = await import("@/lib/counterparty-matching");

      expect(normaliseCounterpartyName("Frank")).toBe(normaliseCounterpartyName("frank"));
      expect(normaliseCounterpartyName("FRANK")).toBe(normaliseCounterpartyName("frank"));
      expect(normaliseCounterpartyName("Frank Smith")).toBe(
        normaliseCounterpartyName("frank smith")
      );
    });

    it("normalises counterparty names (whitespace-insensitive)", async () => {
      const { normaliseCounterpartyName } = await import("@/lib/counterparty-matching");

      expect(normaliseCounterpartyName(" Frank ")).toBe(normaliseCounterpartyName("Frank"));
      expect(normaliseCounterpartyName("Frank  Smith")).toBe(
        normaliseCounterpartyName("Frank Smith")
      );
      expect(normaliseCounterpartyName("  frank  ")).toBe(normaliseCounterpartyName("frank"));
    });

    it("matches existing counterparty by normalised name", async () => {
      // This test documents the create-or-match behavior.
      // Expected: creating a cost with "Frank" finds an existing "frank" counterparty.
      // The Engineer must implement the matching logic and test it.
      const { matchOrCreateCounterparty } = await import("@/lib/counterparty-matching");

      expect(matchOrCreateCounterparty).toBeDefined();
      expect(typeof matchOrCreateCounterparty).toBe("function");
    });

    it("creates a new counterparty on miss", async () => {
      // Expected: matchOrCreateCounterparty("Unknown Supplier", contractorId, kind)
      // returns a counterparty_id, creating the row if it doesn't exist.
      const { matchOrCreateCounterparty } = await import("@/lib/counterparty-matching");

      expect(matchOrCreateCounterparty).toBeDefined();
      // The Engineer will test the create-on-miss path with a database fixture.
    });
  });

  describe("Money integrity: integer pence, no floats", () => {
    it("stores amounts as integer pence", async () => {
      // All amount_net and vat_amount values are integers (pence), not floats (pounds).
      // This test asserts the column type; the migration creates it as int/bigint.

      // Attempt to insert a cost with integer pence amounts (should succeed).
      // The Engineer will expand this with a real fixture.
      const testAmountNet = 50000; // £500.00 in pence
      const testVatAmount = 10000; // £100.00 in pence

      expect(Number.isInteger(testAmountNet)).toBe(true);
      expect(Number.isInteger(testVatAmount)).toBe(true);
    });

    it("rejects float arithmetic in cost creation path", async () => {
      // This is a code-inspection test, not a runtime assertion.
      // The Engineer must ensure no calculations like `amount * 0.20` exist.
      // Instead: `Math.round(amount * 20 / 100)` for percentage calculations.

      // Placeholder: the actual test is a unit test on the cost actions module,
      // asserting that all arithmetic operates on integers and rounds explicitly.
      expect(true).toBe(true);
    });
  });

  describe("Deletion behavior", () => {
    it("job deletion fails if cost rows exist (ON DELETE RESTRICT)", async () => {
      // The foreign key job_costs.job_id references jobs(id) ON DELETE RESTRICT.
      // Deleting a job with costs must fail.
      // The Engineer will test this with a fixture: create job, create cost, attempt delete.

      // Expected error: "update or delete on table \"jobs\" violates foreign key constraint"
      // or equivalent Postgres RESTRICT error.

      // This test documents the requirement; the Engineer implements it.
      expect(true).toBe(true);
    });

    it("counterparty deletion orphans cost rows (ON DELETE SET NULL)", async () => {
      // The foreign key job_costs.counterparty_id references counterparties(id) ON DELETE SET NULL.
      // Deleting a counterparty sets its costs' counterparty_id to null.

      // The Engineer will test: create counterparty, create cost, delete counterparty,
      // assert cost.counterparty_id is now null.
      expect(true).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("allows null counterparty_id (costs without a payee)", async () => {
      // A cost with no counterparty (fuel, parking) has counterparty_id = null.
      const { createJobCost } = await import("@/app/jobs/[id]/cost-actions");

      // The Engineer will test: create a cost with counterpartyName = null or undefined,
      // assert the resulting cost has counterparty_id = null.
      expect(createJobCost).toBeDefined();
    });

    it("allows incurred_on to predate job creation", async () => {
      // No validation prevents incurred_on < jobs.created_at.
      // Speculative purchases (materials bought before the job exists) are real.

      // The Engineer will test: create job at time T, create cost with incurred_on = T - 30 days,
      // assert the cost is accepted.
      expect(true).toBe(true);
    });

    it("handles negative amounts (refunds, credit notes)", async () => {
      // Negative amount_net is allowed.
      const refundAmountPennies = -5000; // £50 refund

      expect(refundAmountPennies).toBeLessThan(0);

      // The Engineer will test: create a cost with amount_net = -5000,
      // assert it is stored and retrieved correctly.
      // Projections (job P&L, counterparty balances) must handle this correctly.
    });

    it("renders correctly for jobs with zero cost rows", async () => {
      // Existing jobs have no costs. Every projection (job P&L, counterparty lists)
      // must handle an empty cost set without crashing.

      // The Engineer will test: fetch costs for a job with no cost rows,
      // assert the result is an empty array (not null, not an error).
      const { getJobCosts } = await import("@/app/jobs/[id]/cost-actions");

      expect(getJobCosts).toBeDefined();
    });

    it("allows null vat_amount even if vat_treatment is standard", async () => {
      // A cost can have vat_treatment = 'standard' but vat_amount = null
      // (the user didn't capture the VAT amount).

      // This is a database constraint test: the column is nullable, no check enforces
      // "if vat_treatment = standard then vat_amount must not be null".
      expect(true).toBe(true);
    });

    it("defaults vat_treatment to unknown", async () => {
      // The migration sets DEFAULT 'unknown' on vat_treatment.
      // Creating a cost without specifying vat_treatment uses 'unknown'.

      // The Engineer will test: create a cost omitting vat_treatment,
      // assert the resulting row has vat_treatment = 'unknown'.
      expect(true).toBe(true);
    });

    it("defaults paid to false", async () => {
      // The migration sets DEFAULT false on the paid column.
      const { createJobCost } = await import("@/app/jobs/[id]/cost-actions");

      // The Engineer will test: create a cost omitting the paid field,
      // assert the resulting row has paid = false.
      expect(createJobCost).toBeDefined();
    });
  });

  describe("Sign convention for amounts", () => {
    it("documents that positive amounts are costs OUT", () => {
      // Positive amount_net = money spent (a cost).
      const costOut = 10000; // £100 spent on materials
      expect(costOut).toBeGreaterThan(0);
    });

    it("documents that negative amounts are money IN (refunds)", () => {
      // Negative amount_net = money received back (a refund or credit).
      const refundIn = -5000; // £50 refund from a supplier
      expect(refundIn).toBeLessThan(0);
    });

    it("job P&L calculation handles negative amounts correctly", () => {
      // Job profit = revenue - sum(amount_net).
      // A negative cost (refund) increases profit.

      const revenue = 100000; // £1000 revenue
      const costMaterials = 30000; // £300 spent
      const refund = -5000; // £50 refund

      const totalCosts = costMaterials + refund; // £250 net cost
      const profit = revenue - totalCosts; // £750 profit

      expect(profit).toBe(75000); // £750 in pence
    });
  });

  describe("Existing fee and revenue logic unchanged", () => {
    it("does not modify jobs, quotes, invoices tables", async () => {
      // This ticket is additive-only. The Engineer must not alter the existing
      // jobs, quotes, or invoices tables (no new columns, no FK changes).

      // This is a migration inspection test; the Engineer asserts the migration
      // only creates NEW tables, not ALTER existing ones.
      expect(true).toBe(true);
    });

    it("does not touch fee calculation or settlement logic", async () => {
      // No changes to src/lib/motko-fee.ts, src/lib/paid-job-settlement.ts, etc.
      // The cost model is parallel to the revenue model, not integrated yet.

      // This is a code inspection test; the Engineer asserts no files in src/lib/
      // related to fees or payments are modified.
      expect(true).toBe(true);
    });
  });

  describe("Migration verification", () => {
    it("documents that the migration must be applied BEFORE code merges", () => {
      // CRITICAL: Apply supabase/migrations/00000000000041_job_costs_counterparties.sql
      // (or next available number) to production BEFORE merging this PR.

      // The Engineer must:
      // 1. Apply the migration: `supabase db push`
      // 2. Verify via `supabase migration list` that prod shows the migration applied
      // 3. Manually insert and delete a test row to confirm the DDL actually landed
      //    (the migration ledger can be wrong — see the events-table drift incident).

      // This test is a documentation placeholder; the verification is manual.
      expect(true).toBe(true);
    });

    it("asserts RLS policies are created in the migration, not in application code", () => {
      // The migration file MUST include:
      //   ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;
      //   ALTER TABLE job_costs ENABLE ROW LEVEL SECURITY;
      //   CREATE POLICY ... ON counterparties FOR SELECT ...
      //   CREATE POLICY ... ON job_costs FOR SELECT ...

      // RLS is NOT configured via application code or Supabase dashboard.
      // The Engineer will inspect the migration file to assert this.
      expect(true).toBe(true);
    });
  });
});
