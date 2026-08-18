import { describe, it, expect, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Integration tests for job costs deletion behavior (Issue #244)
 *
 * These tests verify:
 * 1. ON DELETE RESTRICT on job_id - deleting a job with costs fails
 * 2. ON DELETE SET NULL on counterparty_id - deleting a counterparty orphans costs
 *
 * The acceptance tests have placeholders for these scenarios, but these tests
 * actually verify the database constraints work as specified.
 */

describe("Issue #244: Deletion behavior for job costs", () => {
  const skipTest = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
                   !process.env.SUPABASE_SERVICE_ROLE_KEY;

  const getAdmin = () => createAdminClient();

  let contractorId: string;
  let jobId: string;
  let counterpartyId: string;
  let costId: string;

  beforeEach(async () => {
    if (skipTest) return;

    // Clean up test data
    await getAdmin().from("job_costs").delete().ilike("description", "TEST-244-DEL-%");
    await getAdmin().from("jobs").delete().ilike("title", "TEST-244-DEL-%");
    await getAdmin().from("counterparties").delete().ilike("name", "TEST-244-DEL-%");
    await getAdmin().from("contractors").delete().ilike("business_name", "TEST-244-DEL-%");

    // Create test contractor
    const { data: contractor } = await admin
      .from("contractors")
      .insert({
        business_name: "TEST-244-DEL-Contractor",
        owner_user_id: `test-user-del-${Date.now()}`,
      })
      .select("id")
      .single();

    contractorId = contractor!.id;

    // Create test job
    const { data: job } = await admin
      .from("jobs")
      .insert({
        contractor_id: contractorId,
        title: "TEST-244-DEL-Job",
        status: "quote_sent",
      })
      .select("id")
      .single();

    jobId = job!.id;

    // Create test counterparty
    const { data: counterparty } = await admin
      .from("counterparties")
      .insert({
        contractor_id: contractorId,
        name: "TEST-244-DEL-Supplier",
        kind: "supplier",
      })
      .select("id")
      .single();

    counterpartyId = counterparty!.id;

    // Create test cost
    const { data: cost } = await admin
      .from("job_costs")
      .insert({
        job_id: jobId,
        contractor_id: contractorId,
        counterparty_id: counterpartyId,
        description: "TEST-244-DEL-Cost",
        amount_net: 25000,
        vat_treatment: "standard",
        category: "materials",
        incurred_on: "2026-08-15",
        source: "manual",
      })
      .select("id")
      .single();

    costId = cost!.id;
  });

  it.skipIf(skipTest)(
    "deleting a job with costs fails due to ON DELETE RESTRICT",
    async () => {
      // Attempt to delete the job that has a cost attached
      const { error } = await admin
        .from("jobs")
        .delete()
        .eq("id", jobId);

      // Should fail with foreign key violation
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/violates foreign key constraint|RESTRICT|referenced/i);

      // Verify the job still exists
      const { data: job } = await admin
        .from("jobs")
        .select("id")
        .eq("id", jobId)
        .single();

      expect(job).not.toBeNull();
      expect(job?.id).toBe(jobId);
    }
  );

  it.skipIf(skipTest)(
    "deleting a job with no costs succeeds",
    async () => {
      // Create a job with no costs
      const { data: emptyJob } = await admin
        .from("jobs")
        .insert({
          contractor_id: contractorId,
          title: "TEST-244-DEL-Empty-Job",
          status: "quote_sent",
        })
        .select("id")
        .single();

      // Should succeed
      const { error } = await admin
        .from("jobs")
        .delete()
        .eq("id", emptyJob!.id);

      expect(error).toBeNull();

      // Verify the job is gone
      const { data: job } = await admin
        .from("jobs")
        .select("id")
        .eq("id", emptyJob!.id)
        .maybeSingle();

      expect(job).toBeNull();
    }
  );

  it.skipIf(skipTest)(
    "deleting a counterparty sets costs' counterparty_id to null (ON DELETE SET NULL)",
    async () => {
      // Verify the cost has the counterparty_id set
      const { data: costBefore } = await admin
        .from("job_costs")
        .select("counterparty_id")
        .eq("id", costId)
        .single();

      expect(costBefore?.counterparty_id).toBe(counterpartyId);

      // Delete the counterparty
      const { error: deleteError } = await admin
        .from("counterparties")
        .delete()
        .eq("id", counterpartyId);

      expect(deleteError).toBeNull();

      // Verify the cost still exists but counterparty_id is now null
      const { data: costAfter } = await admin
        .from("job_costs")
        .select("*")
        .eq("id", costId)
        .single();

      expect(costAfter).not.toBeNull();
      expect(costAfter?.id).toBe(costId);
      expect(costAfter?.counterparty_id).toBeNull();
      expect(costAfter?.description).toBe("TEST-244-DEL-Cost");
    }
  );

  it.skipIf(skipTest)(
    "a cost can be created with null counterparty_id",
    async () => {
      // Create a cost without a counterparty (e.g., fuel purchase)
      const { data: cost, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          counterparty_id: null,
          description: "TEST-244-DEL-Fuel",
          amount_net: 5000,
          vat_treatment: "standard",
          category: "other",
          incurred_on: "2026-08-15",
          source: "manual",
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(cost?.counterparty_id).toBeNull();
      expect(cost?.description).toBe("TEST-244-DEL-Fuel");
    }
  );

  it.skipIf(skipTest)(
    "error message from restricted deletion is surfaced",
    async () => {
      // This test documents that the error from ON DELETE RESTRICT
      // is returned and can be surfaced to the user
      const { error } = await admin
        .from("jobs")
        .delete()
        .eq("id", jobId);

      // The error should contain information about the constraint
      expect(error).not.toBeNull();
      expect(error?.code).toBeDefined();

      // PostgreSQL error code for foreign key violation is typically 23503
      // The message should indicate the constraint name or table
      const errorMessage = error?.message.toLowerCase() ?? "";
      const hasRelevantInfo =
        errorMessage.includes("job_costs") ||
        errorMessage.includes("foreign key") ||
        errorMessage.includes("constraint");

      expect(hasRelevantInfo).toBe(true);
    }
  );
});
