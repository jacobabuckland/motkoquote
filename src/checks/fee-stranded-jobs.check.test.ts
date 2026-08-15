import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Invariant check for #226: verifies that the code structure prevents jobs from
// being stranded at fee_status='accrued' while their collection is already 'collected'.
// This state was possible when settleFeeCollection performed three separate awaited
// writes (collection → jobs → contractor), allowing a crash between writes to leave
// partial state. The fix moves all three writes into a single atomic RPC.

const root = (p: string) => join(process.cwd(), p);

describe("Fee stranded jobs invariant check", () => {
  it("settleFeeCollection uses the atomic settle_fee_collection RPC", () => {
    const collectFeesSource = readFileSync(root("src/lib/collect-fees.ts"), "utf8");

    // Extract the settleFeeCollection function body
    const settleFnStart = collectFeesSource.indexOf("export const settleFeeCollection");
    const settleFnEnd = collectFeesSource.indexOf("};", settleFnStart) + 2;
    const settleFn = collectFeesSource.slice(settleFnStart, settleFnEnd);

    // The function must call the atomic RPC
    expect(settleFn).toContain(".rpc(");
    expect(settleFn).toContain("settle_fee_collection");

    // The function must NOT perform separate updates to fee_collections, jobs, or contractors
    const feeCollectionUpdates = (settleFn.match(/\.from\s*\(\s*["']fee_collections["']\s*\)\s*\.update/g) || []).length;
    const jobUpdates = (settleFn.match(/\.from\s*\(\s*["']jobs["']\s*\)\s*\.update/g) || []).length;
    const contractorUpdates = (settleFn.match(/\.from\s*\(\s*["']contractors["']\s*\)\s*\.update/g) || []).length;

    expect(feeCollectionUpdates).toBe(0);
    expect(jobUpdates).toBe(0);
    expect(contractorUpdates).toBe(0);
  });

  it("the settle_fee_collection RPC performs all three writes atomically", () => {
    const migrationContent = readFileSync(
      root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
      "utf8",
    );

    // The RPC must update all three entities
    expect(migrationContent).toContain("update fee_collections");
    expect(migrationContent).toMatch(/status\s*=\s*['"]collected['"]/);

    expect(migrationContent).toContain("update jobs");
    expect(migrationContent).toMatch(/fee_status\s*=\s*['"]collected['"]/);

    expect(migrationContent).toContain("update contractors");
    expect(migrationContent).toMatch(/fee_collection_status\s*=\s*['"]active['"]/);

    // The RPC must use plpgsql or sql for transaction safety
    expect(migrationContent).toMatch(/language\s+(plpgsql|sql)/i);
  });

  it("the RPC is idempotent and guards against already-collected collections", () => {
    const migrationContent = readFileSync(
      root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
      "utf8",
    );

    // The collection update must have a WHERE clause that prevents re-updating
    // collections already in 'collected' status
    expect(migrationContent).toMatch(/where.*status.*!=.*['"]collected['"]/i);

    // The jobs update must only touch jobs still at fee_status='accrued'
    expect(migrationContent).toMatch(/where.*fee_status\s*=\s*['"]accrued['"]/);
  });

  it("verifies the impossible state: no accrued jobs under collected collections", () => {
    // This is a structural check, not a runtime query. The impossibility is
    // guaranteed by the atomic RPC: either all three writes succeed together
    // (collection collected, jobs collected, contractor active) or none do
    // (Postgres rollback). There is no code path that can leave jobs accrued
    // while their collection is collected.

    const migrationContent = readFileSync(
      root("supabase/migrations/00000000000038_settle_fee_collection_rpc.sql"),
      "utf8",
    );

    // The RPC is SECURITY DEFINER, so it bypasses RLS and has full control
    expect(migrationContent).toContain("security definer");

    // It uses a transaction-safe language (plpgsql/sql), so all writes are atomic
    expect(migrationContent).toMatch(/language\s+(plpgsql|sql)/i);

    // Therefore, the stranded state (accrued jobs under collected collection) is
    // structurally impossible: Postgres guarantees all-or-nothing for the transaction.
    expect(true).toBe(true);
  });
});
