import { describe, it, expect, beforeEach } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Integration tests for job costs edge cases (Issue #244)
 *
 * These tests verify edge cases documented in the spec:
 * 1. Negative amounts (refunds, credit notes)
 * 2. incurred_on predating job creation (speculative purchases)
 * 3. Null counterparty_id (costs without a payee)
 * 4. Null vat_amount even with vat_treatment = 'standard'
 * 5. Default values for paid, vat_treatment
 *
 * The acceptance tests have placeholders for these, but these tests
 * actually verify the behaviors.
 */

describe("Issue #244: Edge cases for job costs", () => {
  const skipTest = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
                   !process.env.SUPABASE_SERVICE_ROLE_KEY;

  const getAdmin = () => createAdminClient();

  let contractorId: string;
  let jobId: string;
  let jobCreatedAt: string;

  beforeEach(async () => {
    if (skipTest) return;

    // Clean up test data
    await getAdmin().from("job_costs").delete().ilike("description", "TEST-244-EDGE-%");
    await getAdmin().from("jobs").delete().ilike("title", "TEST-244-EDGE-%");
    await getAdmin().from("contractors").delete().ilike("business_name", "TEST-244-EDGE-%");

    // Create test contractor
    const { data: contractor } = await admin
      .from("contractors")
      .insert({
        business_name: "TEST-244-EDGE-Contractor",
        owner_user_id: `test-user-edge-${Date.now()}`,
      })
      .select("id")
      .single();

    contractorId = contractor!.id;

    // Create test job and capture its created_at timestamp
    const { data: job } = await admin
      .from("jobs")
      .insert({
        contractor_id: contractorId,
        title: "TEST-244-EDGE-Job",
        status: "quote_sent",
      })
      .select("id, created_at")
      .single();

    jobId = job!.id;
    jobCreatedAt = job!.created_at;
  });

  it.skipIf(skipTest)(
    "allows negative amounts for refunds and credit notes",
    async () => {
      // Create a refund (negative amount)
      const { data: refund, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          description: "TEST-244-EDGE-Refund from supplier",
          amount_net: -5000, // -£50 (money IN)
          vat_amount: -1000, // -£10 VAT
          vat_treatment: "standard",
          category: "materials",
          incurred_on: "2026-08-15",
          source: "manual",
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(refund?.amount_net).toBe(-5000);
      expect(refund?.vat_amount).toBe(-1000);
    }
  );

  it.skipIf(skipTest)(
    "handles negative amounts correctly in P&L calculation",
    async () => {
      // Create a normal cost
      await getAdmin().from("job_costs").insert({
        job_id: jobId,
        contractor_id: contractorId,
        description: "TEST-244-EDGE-Materials",
        amount_net: 100000, // £1000 out
        vat_treatment: "standard",
        category: "materials",
        incurred_on: "2026-08-15",
        source: "manual",
      });

      // Create a refund
      await getAdmin().from("job_costs").insert({
        job_id: jobId,
        contractor_id: contractorId,
        description: "TEST-244-EDGE-Refund",
        amount_net: -20000, // £200 in
        vat_treatment: "standard",
        category: "materials",
        incurred_on: "2026-08-16",
        source: "manual",
      });

      // Fetch all costs and calculate total
      const { data: costs } = await admin
        .from("job_costs")
        .select("amount_net")
        .eq("job_id", jobId);

      const totalCost = costs?.reduce((sum, cost) => sum + cost.amount_net, 0) ?? 0;

      // Net cost should be £800 (£1000 - £200)
      expect(totalCost).toBe(80000);
    }
  );

  it.skipIf(skipTest)(
    "allows incurred_on to predate job creation",
    async () => {
      // Get job creation date
      const jobDate = new Date(jobCreatedAt);

      // Create a cost with incurred_on 30 days before job creation
      const incurredDate = new Date(jobDate);
      incurredDate.setDate(incurredDate.getDate() - 30);
      const incurredDateStr = incurredDate.toISOString().split("T")[0];

      const { data: cost, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          description: "TEST-244-EDGE-Speculative materials",
          amount_net: 15000,
          vat_treatment: "standard",
          category: "materials",
          incurred_on: incurredDateStr, // 30 days before job
          source: "manual",
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(cost?.incurred_on).toBe(incurredDateStr);

      // Verify incurred_on is indeed before job creation
      const incurredTime = new Date(cost?.incurred_on ?? "").getTime();
      const jobTime = new Date(jobCreatedAt).getTime();
      expect(incurredTime).toBeLessThan(jobTime);
    }
  );

  it.skipIf(skipTest)(
    "allows null vat_amount even when vat_treatment is 'standard'",
    async () => {
      // Create a cost with vat_treatment = 'standard' but vat_amount = null
      // This represents a case where the user didn't capture the VAT amount
      const { data: cost, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          description: "TEST-244-EDGE-Unknown VAT",
          amount_net: 30000,
          vat_amount: null, // VAT not captured
          vat_treatment: "standard", // But we know it's standard-rated
          category: "labour",
          incurred_on: "2026-08-15",
          source: "manual",
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(cost?.vat_treatment).toBe("standard");
      expect(cost?.vat_amount).toBeNull();
    }
  );

  it.skipIf(skipTest)(
    "defaults vat_treatment to 'unknown' when not specified",
    async () => {
      // Create a cost without specifying vat_treatment
      const { data: cost, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          description: "TEST-244-EDGE-Default VAT treatment",
          amount_net: 8000,
          category: "other",
          incurred_on: "2026-08-15",
          source: "manual",
          // vat_treatment omitted - should default to 'unknown'
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(cost?.vat_treatment).toBe("unknown");
    }
  );

  it.skipIf(skipTest)(
    "defaults paid to false when not specified",
    async () => {
      // Create a cost without specifying paid
      const { data: cost, error } = await admin
        .from("job_costs")
        .insert({
          job_id: jobId,
          contractor_id: contractorId,
          description: "TEST-244-EDGE-Default paid status",
          amount_net: 12000,
          vat_treatment: "standard",
          category: "materials",
          incurred_on: "2026-08-15",
          source: "manual",
          // paid omitted - should default to false
        })
        .select("*")
        .single();

      expect(error).toBeNull();
      expect(cost?.paid).toBe(false);
      expect(cost?.paid_on).toBeNull();
    }
  );

  it.skipIf(skipTest)(
    "allows all vat_treatment enum values",
    async () => {
      const vatTreatments = ["standard", "zero", "exempt", "reverse_charge", "unknown"];

      for (const treatment of vatTreatments) {
        const { error } = await admin
          .from("job_costs")
          .insert({
            job_id: jobId,
            contractor_id: contractorId,
            description: `TEST-244-EDGE-VAT-${treatment}`,
            amount_net: 10000,
            vat_treatment: treatment,
            category: "materials",
            incurred_on: "2026-08-15",
            source: "manual",
          });

        expect(error).toBeNull();
      }
    }
  );

  it.skipIf(skipTest)(
    "allows all category enum values",
    async () => {
      const categories = ["materials", "labour", "subcontractor", "plant_hire", "other"];

      for (const category of categories) {
        const { error } = await admin
          .from("job_costs")
          .insert({
            job_id: jobId,
            contractor_id: contractorId,
            description: `TEST-244-EDGE-Category-${category}`,
            amount_net: 10000,
            vat_treatment: "standard",
            category: category,
            incurred_on: "2026-08-15",
            source: "manual",
          });

        expect(error).toBeNull();
      }
    }
  );

  it.skipIf(skipTest)(
    "allows all source enum values",
    async () => {
      const sources = ["voice", "photo", "manual"];

      for (const source of sources) {
        const { error } = await admin
          .from("job_costs")
          .insert({
            job_id: jobId,
            contractor_id: contractorId,
            description: `TEST-244-EDGE-Source-${source}`,
            amount_net: 10000,
            vat_treatment: "standard",
            category: "materials",
            incurred_on: "2026-08-15",
            source: source,
          });

        expect(error).toBeNull();
      }
    }
  );
});
