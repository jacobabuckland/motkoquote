"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const addJobCostSchema = z.object({
  description: z.string().min(1),
  amountPence: z.number().int(),
  category: z.string().optional(),
  counterparty: z.string().optional(),
  incurredOn: z.string(), // yyyy-mm-dd date string
  vatTreatment: z.enum(["standard", "zero", "exempt"]),
});

const updateJobCostSchema = z.object({
  description: z.string().min(1),
  amountPence: z.number().int(),
  category: z.string().optional(),
  counterparty: z.string().optional(),
  incurredOn: z.string(), // yyyy-mm-dd date string
  vatTreatment: z.enum(["standard", "zero", "exempt"]),
});

export type AddJobCostInput = z.infer<typeof addJobCostSchema>;
export type UpdateJobCostInput = z.infer<typeof updateJobCostSchema>;

export async function addJobCost(
  jobId: string,
  input: AddJobCostInput,
): Promise<{ success: boolean; costId?: string; error?: string }> {
  const parsed = addJobCostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  const { description, amountPence, category, counterparty, incurredOn, vatTreatment } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // Verify job ownership via RLS
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    return { success: false, error: "Job not found" };
  }

  const { data, error } = await supabase
    .from("job_costs")
    .insert({
      job_id: jobId,
      description,
      amount_pence: amountPence,
      category: category || null,
      counterparty: counterparty || null,
      incurred_on: incurredOn,
      vat_treatment: vatTreatment,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: "Failed to add cost" };
  }

  revalidatePath("/jobs/[id]", "page");
  return { success: true, costId: data.id };
}

export async function updateJobCost(
  costId: string,
  input: UpdateJobCostInput,
): Promise<{ success: boolean; error?: string }> {
  const parsed = updateJobCostSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid input" };
  }

  const { description, amountPence, category, counterparty, incurredOn, vatTreatment } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // RLS will prevent updating costs from other contractors
  const { error } = await supabase
    .from("job_costs")
    .update({
      description,
      amount_pence: amountPence,
      category: category || null,
      counterparty: counterparty || null,
      incurred_on: incurredOn,
      vat_treatment: vatTreatment,
    })
    .eq("id", costId);

  if (error) {
    return { success: false, error: "Failed to update cost" };
  }

  revalidatePath("/jobs/[id]", "page");
  return { success: true };
}

export async function deleteJobCost(
  costId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // RLS will prevent deleting costs from other contractors
  const { error } = await supabase.from("job_costs").delete().eq("id", costId);

  if (error) {
    return { success: false, error: "Failed to delete cost" };
  }

  revalidatePath("/jobs/[id]", "page");
  return { success: true };
}

export async function markCostPaid(
  costId: string,
  paid: boolean,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // Set paid_on to today (London timezone date) when marking paid, clear when marking unpaid
  const today = new Date().toISOString().split("T")[0]; // yyyy-mm-dd in UTC (close enough for London)

  // RLS will prevent marking costs from other contractors
  const { error } = await supabase
    .from("job_costs")
    .update({
      paid,
      paid_on: paid ? today : null,
    })
    .eq("id", costId);

  if (error) {
    return { success: false, error: "Failed to update cost" };
  }

  revalidatePath("/jobs/[id]", "page");
  return { success: true };
}
