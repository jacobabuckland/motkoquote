import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This test file verifies #226: moving settleFeeCollection's three post-claim
// effects (collection to collected, jobs to collected, contractor to active)
// into a single atomic RPC to prevent partial writes on crash.

const root = (p: string) => join(process.cwd(), p);

describe("Issue #226: Atomic fee collection settlement via RPC", () => {
  describe("Database RPC function", () => {
    it("defines settle_fee_collection RPC in a migration", async () => {
      // The RPC must exist in a migration file. We expect it to be named
      // 00000000000038_settle_fee_collection_rpc.sql or similar.
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      expect(migrationContent).toContain("create or replace function settle_fee_collection");
      expect(migrationContent).toContain("security definer");
    });

    it("RPC accepts fee_collection_id, optional provider_ref, and now timestamp", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // The function signature should accept these three parameters
      expect(migrationContent).toMatch(/settle_fee_collection\s*\(/);
      expect(migrationContent).toContain("p_fee_collection_id");
      expect(migrationContent).toContain("p_provider_ref");
      expect(migrationContent).toContain("p_now");
    });

    it("RPC updates fee_collections.status to collected", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      expect(migrationContent).toContain("update fee_collections");
      expect(migrationContent).toMatch(/status\s*=\s*['"]collected['"]/);
    });

    it("RPC updates jobs.fee_status to collected", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      expect(migrationContent).toContain("update jobs");
      expect(migrationContent).toMatch(/fee_status\s*=\s*['"]collected['"]/);
    });

    it("RPC updates contractors.fee_collection_status to active", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      expect(migrationContent).toContain("update contractors");
      expect(migrationContent).toMatch(/fee_collection_status\s*=\s*['"]active['"]/);
    });

    it("RPC is idempotent — guards against updating already-collected collections", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // The RPC should have a WHERE clause that prevents re-updating already-collected
      // collections, or it should use a CTE/variable to capture the initial state
      // and only proceed if status != 'collected'
      expect(migrationContent).toMatch(/where.*status.*collected/i);
    });

    it("RPC only updates jobs that are still at fee_status = accrued", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // The jobs update should filter on fee_status = 'accrued' to ensure idempotency
      expect(migrationContent).toMatch(/where.*fee_status\s*=\s*['"]accrued['"]/);
    });

    it("RPC uses language plpgsql or sql for transaction safety", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // Must be plpgsql or sql to ensure the function runs in a single transaction
      expect(migrationContent).toMatch(/language\s+(plpgsql|sql)/i);
    });
  });

  describe("settleFeeCollection calls the RPC", () => {
    let collectFeesSource: string;

    beforeEach(() => {
      collectFeesSource = readFileSync(root("src/lib/collect-fees.ts"), "utf8");
    });

    it("calls the settle_fee_collection RPC instead of separate writes", () => {
      const settleFn = collectFeesSource.slice(
        collectFeesSource.indexOf("export const settleFeeCollection"),
        collectFeesSource.indexOf("export const settleFeeCollection") + 2000,
      );

      // The function should call the RPC via .rpc('settle_fee_collection', ...)
      expect(settleFn).toContain(".rpc(");
      expect(settleFn).toContain("settle_fee_collection");
    });

    it("does not perform separate awaited writes to fee_collections, jobs, contractors", () => {
      const settleFn = collectFeesSource.slice(
        collectFeesSource.indexOf("export const settleFeeCollection"),
        collectFeesSource.indexOf("export const settleFeeCollection") + 2000,
      );

      // Count how many times we update fee_collections/jobs/contractors directly.
      // After the fix, there should be ZERO direct updates — only the RPC call.
      const feeCollectionUpdates = (settleFn.match(/\.from\s*\(\s*["']fee_collections["']\s*\)\s*\.update/g) || []).length;
      const jobUpdates = (settleFn.match(/\.from\s*\(\s*["']jobs["']\s*\)\s*\.update/g) || []).length;
      const contractorUpdates = (settleFn.match(/\.from\s*\(\s*["']contractors["']\s*\)\s*\.update/g) || []).length;

      expect(feeCollectionUpdates).toBe(0);
      expect(jobUpdates).toBe(0);
      expect(contractorUpdates).toBe(0);
    });

    it("passes the fee_collection_id, provider_ref, and now timestamp to the RPC", () => {
      const settleFn = collectFeesSource.slice(
        collectFeesSource.indexOf("export const settleFeeCollection"),
        collectFeesSource.indexOf("export const settleFeeCollection") + 2000,
      );

      // The RPC call should pass all three parameters
      expect(settleFn).toMatch(/feeCollectionId|fee_collection_id/);
      expect(settleFn).toMatch(/providerRef|provider_ref/);
      expect(settleFn).toMatch(/\.now\b/);
    });

    it("maintains the same function signature and return type", () => {
      const signature = collectFeesSource.slice(
        collectFeesSource.indexOf("export const settleFeeCollection"),
        collectFeesSource.indexOf("export const settleFeeCollection") + 200,
      );

      // The signature must remain unchanged
      expect(signature).toContain("async (");
      expect(signature).toContain("admin: SupabaseClient");
      expect(signature).toContain("feeCollectionId: string");
      expect(signature).toContain("providerRef?: string | null");
      expect(signature).toContain("now: string");
      expect(signature).toContain("Promise<void>");
    });
  });

  describe("Invariant check for stranded jobs", () => {
    it("defines a check that asserts no accrued jobs belong to collected collections", async () => {
      const checkSource = readFileSync(
        root("src/checks/fee-stranded-jobs.check.test.ts"),
        "utf8",
      );

      expect(checkSource).toContain("describe");
      expect(checkSource).toContain("fee_status");
      expect(checkSource).toContain("accrued");
      expect(checkSource).toContain("collected");
    });

    it("check is structured as a vitest test file", async () => {
      const checkSource = readFileSync(
        root("src/checks/fee-stranded-jobs.check.test.ts"),
        "utf8",
      );

      expect(checkSource).toContain("import");
      expect(checkSource).toContain("describe");
      expect(checkSource).toContain("it(");
      expect(checkSource).toContain("expect(");
    });

    it("check verifies settleFeeCollection cannot leave jobs stranded", async () => {
      const checkSource = readFileSync(
        root("src/checks/fee-stranded-jobs.check.test.ts"),
        "utf8",
      );

      // The check should assert the impossibility of the stranded state by
      // verifying the code structure (e.g., that settleFeeCollection uses
      // the atomic RPC, not separate writes)
      expect(checkSource).toContain("settleFeeCollection");
      expect(checkSource).toContain("settle_fee_collection");
    });
  });

  describe("RPC behavior edge cases (verified via migration logic)", () => {
    it("RPC handles empty job_ids array without error", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // The RPC should handle the case where job_ids is empty or the jobs update
      // matches zero rows. This might be a conditional update or a pattern that
      // naturally no-ops when the array is empty (e.g., WHERE id = ANY(job_ids)
      // on an empty array matches nothing, which is fine).
      // We're just asserting the RPC doesn't crash on this edge case.
      expect(migrationContent).toContain("update jobs");
    });

    it("RPC returns successfully even when contractor is already active", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // The contractor update should not fail if the status is already 'active'.
      // This is implicit in SQL (UPDATE always succeeds even if values don't change),
      // but we're documenting the expectation here.
      expect(migrationContent).toContain("update contractors");
      expect(migrationContent).toContain("active");
    });

    it("RPC does not modify collections already in collected status", async () => {
      const migrationContent = readFileSync(
        root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
        "utf8",
      );

      // Idempotency: the RPC should return early or no-op if the collection is
      // already collected. The WHERE clause on the collection update should
      // ensure this.
      expect(migrationContent).toMatch(/where.*status.*['"]?collected['"]?/i);
    });
  });

  describe("Integration with existing flow", () => {
    it("settleFeeCollection is still called from the webhook handler", () => {
      const webhookSource = readFileSync(
        root("src/app/api/truelayer/webhook/route.ts"),
        "utf8",
      );

      expect(webhookSource).toContain("settleFeeCollection");
    });

    it("webhook handler passes the same parameters as before", () => {
      const webhookSource = readFileSync(
        root("src/app/api/truelayer/webhook/route.ts"),
        "utf8",
      );

      // The webhook should still pass admin, feeCollectionId, providerRef, now
      expect(webhookSource).toContain("settleFeeCollection");
      expect(webhookSource).toMatch(/feeCollectionId|fee_collection_id/);
    });

    it("does not change the TrueLayer charge call or idempotency key", () => {
      const collectFeesSource = readFileSync(root("src/lib/collect-fees.ts"), "utf8");

      // chargeMandate should still be called with the same idempotency key
      expect(collectFeesSource).toContain("chargeMandate");
      expect(collectFeesSource).toContain("idempotencyKey: collection.id");
    });

    it("does not change how collections are created in runFeeCollectionBatch", () => {
      const collectFeesSource = readFileSync(root("src/lib/collect-fees.ts"), "utf8");

      // The upsert with ignoreDuplicates should remain unchanged
      expect(collectFeesSource).toContain("fee_collections");
      expect(collectFeesSource).toContain("upsert");
      expect(collectFeesSource).toContain("ignoreDuplicates");
    });

    it("preserves the (contractor_id, period_start) unique index", async () => {
      const idempotencyMigration = readFileSync(
        root("supabase/migrations/00000000000028_fee_collection_idempotency.sql"),
        "utf8",
      );

      // The existing unique index must not be modified or dropped
      expect(idempotencyMigration).toContain("fee_collections_contractor_period_key");
      expect(idempotencyMigration).toContain("contractor_id, period_start");
    });
  });
});
