"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createJobCostSchema,
  updateJobCostSchema,
  markCostPaidSchema,
} from "@/lib/schemas/job-cost";
import { matchOrCreateCounterparty } from "@/lib/counterparty-matching";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Create a new cost row for a job.
 * If a counterparty name is provided, match or create the counterparty first.
 * All amounts must be in integer pence (no floats).
 */
export const createJobCost = async (
  raw: unknown,
): Promise<Result<{ id: string; counterpartyId: string | null }>> => {
  const parsed = createJobCostSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Get the contractor ID for the current user
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    return { ok: false, error: "Contractor not found." };
  }

  // Verify the job belongs to this contractor
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", parsed.data.jobId)
    .eq("contractor_id", contractor.id)
    .single();

  if (jobError || !job) {
    return { ok: false, error: "Job not found or access denied." };
  }

  // Match or create counterparty if a name is provided
  let counterpartyId: string | null = null;
  if (parsed.data.counterpartyName && parsed.data.counterpartyName.trim()) {
    try {
      counterpartyId = await matchOrCreateCounterparty(
        parsed.data.counterpartyName,
        contractor.id,
        parsed.data.counterpartyKind ?? "other",
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to process counterparty.",
      };
    }
  }

  // Create the cost row using admin client (bypasses RLS for insert)
  const admin = createAdminClient();
  const { data: cost, error: costError } = await admin
    .from("job_costs")
    .insert({
      job_id: parsed.data.jobId,
      contractor_id: contractor.id,
      counterparty_id: counterpartyId,
      description: parsed.data.description,
      amount_net: parsed.data.amountNet,
      vat_amount: parsed.data.vatAmount ?? null,
      vat_treatment: parsed.data.vatTreatment,
      category: parsed.data.category,
      incurred_on: parsed.data.incurredOn,
      paid: parsed.data.paid,
      paid_on: parsed.data.paidOn ?? null,
      evidence_url: parsed.data.evidenceUrl ?? null,
      source: parsed.data.source,
    })
    .select("id")
    .single();

  if (costError) {
    return { ok: false, error: `Failed to create cost: ${costError.message}` };
  }

  revalidatePath(`/jobs/${parsed.data.jobId}`);
  return { ok: true, data: { id: cost.id, counterpartyId } };
};

/**
 * Update an existing cost row.
 * Only the fields provided in the input are updated.
 */
export const updateJobCost = async (raw: unknown): Promise<Result<{ id: string }>> => {
  const parsed = updateJobCostSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Get the contractor ID for the current user
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    return { ok: false, error: "Contractor not found." };
  }

  // Verify the cost belongs to this contractor
  const { data: cost, error: costError } = await supabase
    .from("job_costs")
    .select("job_id")
    .eq("id", parsed.data.costId)
    .eq("contractor_id", contractor.id)
    .single();

  if (costError || !cost) {
    return { ok: false, error: "Cost not found or access denied." };
  }

  // Build the update object with only the provided fields
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.amountNet !== undefined) updateData.amount_net = parsed.data.amountNet;
  if (parsed.data.vatAmount !== undefined) updateData.vat_amount = parsed.data.vatAmount;
  if (parsed.data.vatTreatment !== undefined) updateData.vat_treatment = parsed.data.vatTreatment;
  if (parsed.data.category !== undefined) updateData.category = parsed.data.category;
  if (parsed.data.incurredOn !== undefined) updateData.incurred_on = parsed.data.incurredOn;
  if (parsed.data.paid !== undefined) updateData.paid = parsed.data.paid;
  if (parsed.data.paidOn !== undefined) updateData.paid_on = parsed.data.paidOn;
  if (parsed.data.evidenceUrl !== undefined) updateData.evidence_url = parsed.data.evidenceUrl;

  // Update using admin client
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("job_costs")
    .update(updateData)
    .eq("id", parsed.data.costId);

  if (updateError) {
    return { ok: false, error: `Failed to update cost: ${updateError.message}` };
  }

  revalidatePath(`/jobs/${cost.job_id}`);
  return { ok: true, data: { id: parsed.data.costId } };
};

/**
 * Mark a cost as paid.
 * Convenience action to set paid = true and paid_on = <date>.
 */
export const markCostPaid = async (raw: unknown): Promise<Result<{ id: string }>> => {
  const parsed = markCostPaidSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Get the contractor ID for the current user
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    return { ok: false, error: "Contractor not found." };
  }

  // Verify the cost belongs to this contractor
  const { data: cost, error: costError } = await supabase
    .from("job_costs")
    .select("job_id")
    .eq("id", parsed.data.costId)
    .eq("contractor_id", contractor.id)
    .single();

  if (costError || !cost) {
    return { ok: false, error: "Cost not found or access denied." };
  }

  // Mark as paid using admin client
  const admin = createAdminClient();
  const { error: updateError } = await admin
    .from("job_costs")
    .update({
      paid: true,
      paid_on: parsed.data.paidOn,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.costId);

  if (updateError) {
    return { ok: false, error: `Failed to mark cost as paid: ${updateError.message}` };
  }

  revalidatePath(`/jobs/${cost.job_id}`);
  return { ok: true, data: { id: parsed.data.costId } };
};

/**
 * Delete a cost row.
 * Verifies the cost belongs to the current contractor before deletion.
 */
export const deleteJobCost = async (costId: string): Promise<Result<{ id: string }>> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Get the contractor ID for the current user
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    return { ok: false, error: "Contractor not found." };
  }

  // Verify the cost belongs to this contractor and get job_id for revalidation
  const { data: cost, error: costError } = await supabase
    .from("job_costs")
    .select("job_id")
    .eq("id", costId)
    .eq("contractor_id", contractor.id)
    .single();

  if (costError || !cost) {
    return { ok: false, error: "Cost not found or access denied." };
  }

  // Delete using admin client
  const admin = createAdminClient();
  const { error: deleteError } = await admin
    .from("job_costs")
    .delete()
    .eq("id", costId);

  if (deleteError) {
    return { ok: false, error: `Failed to delete cost: ${deleteError.message}` };
  }

  revalidatePath(`/jobs/${cost.job_id}`);
  return { ok: true, data: { id: costId } };
};

/**
 * Get all costs for a job, RLS-scoped to the current contractor.
 */
export const getJobCosts = async (
  jobId: string,
): Promise<
  Result<
    Array<{
      id: string;
      description: string;
      amountNet: number;
      vatAmount: number | null;
      vatTreatment: string;
      category: string;
      incurredOn: string;
      paid: boolean;
      paidOn: string | null;
      evidenceUrl: string | null;
      source: string;
      createdAt: string;
      updatedAt: string;
      counterpartyId: string | null;
      counterpartyName: string | null;
    }>
  >
> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Get the contractor ID for the current user
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();

  if (contractorError || !contractor) {
    return { ok: false, error: "Contractor not found." };
  }

  // Fetch costs using RLS-scoped client, including counterparty name
  const { data: costs, error: costsError } = await supabase
    .from("job_costs")
    .select("*, counterparty:counterparties(name)")
    .eq("job_id", jobId)
    .eq("contractor_id", contractor.id)
    .order("incurred_on", { ascending: false });

  if (costsError) {
    return { ok: false, error: `Failed to fetch costs: ${costsError.message}` };
  }

  // Map to camelCase for client consumption
  const mapped = (costs ?? []).map((cost) => ({
    id: cost.id,
    description: cost.description,
    amountNet: cost.amount_net,
    vatAmount: cost.vat_amount,
    vatTreatment: cost.vat_treatment,
    category: cost.category,
    incurredOn: cost.incurred_on,
    paid: cost.paid,
    paidOn: cost.paid_on,
    evidenceUrl: cost.evidence_url,
    source: cost.source,
    createdAt: cost.created_at,
    updatedAt: cost.updated_at,
    counterpartyId: cost.counterparty_id,
    counterpartyName: cost.counterparty?.name ?? null,
  }));

  return { ok: true, data: mapped };
};
