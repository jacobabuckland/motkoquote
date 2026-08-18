"use server";

import { createClient } from "@/lib/supabase/server";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { buildCostIntakeInstructions, COST_INTAKE_TOOLS } from "@/lib/voice/cost-intake-prompt";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { matchJobBySpokenReference } from "@/lib/match-job";
import { createJobCost } from "@/app/jobs/[id]/cost-actions";
import { redirect } from "next/navigation";

const REALTIME_TOOLS: RealtimeToolDef[] = COST_INTAKE_TOOLS;

export type CostRealtimeSessionResult = {
  sessionKey: string | null;
  clientSecret: string;
};

/**
 * Create a Realtime API session for voice cost capture.
 *
 * Returns:
 * - sessionKey: null (cost capture sessions are stateless)
 * - clientSecret: OpenAI Realtime API ephemeral token
 */
export async function createCostRealtimeSession(): Promise<CostRealtimeSessionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) throw new Error("Contractor not found");

  // Fetch contractor's jobs for job matching
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, customer_name, job_reference, updated_at")
    .eq("contractor_id", contractor.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  const jobsList = jobs ?? [];

  const instructions = buildCostIntakeInstructions({
    contractorName: contractor.company_name,
    jobs: jobsList.map((j) => ({
      id: j.id,
      customer_name: j.customer_name,
      job_reference: j.job_reference,
      updated_at: j.updated_at,
    })),
  });

  const clientSecret = await createRealtimeClientSecret({
    instructions,
    tools: REALTIME_TOOLS,
  });

  return {
    sessionKey: null,
    clientSecret,
  };
}

/**
 * Complete a voice cost capture session by saving the drafted cost.
 *
 * Validates the draft, creates the cost via createJobCost, and redirects
 * to the job page with confirmation.
 */
export async function completeCostCapture(params: {
  jobId: string;
  amountPence: number;
  counterpartyName: string | null;
  category: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  description: string;
  incurredOn: string;
  transcriptExcerpt?: string;
}): Promise<{ success: boolean; jobId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  // Validate the job exists and belongs to this contractor
  const { data: job } = await supabase
    .from("jobs")
    .select("id, contractor_id, customer_name, job_reference")
    .eq("id", params.jobId)
    .maybeSingle();

  if (!job) throw new Error("Job not found");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .eq("id", job.contractor_id)
    .maybeSingle();

  if (!contractor) throw new Error("Unauthorized for this job");

  // Parse and validate amount
  if (params.amountPence <= 0 || params.amountPence > 1_000_000_00) {
    throw new Error("Amount must be between £0.01 and £1,000,000");
  }

  // If a transcript excerpt is provided, verify the amount matches the parsed value
  if (params.transcriptExcerpt) {
    const parsedAmount = parseSpokenMoneyAmount(params.transcriptExcerpt);
    if (parsedAmount !== null && parsedAmount !== params.amountPence) {
      throw new Error(
        `Amount mismatch: transcript parsed to £${(parsedAmount / 100).toFixed(2)} but draft shows £${(params.amountPence / 100).toFixed(2)}`,
      );
    }
  }

  // Create the cost using the existing createJobCost action
  const result = await createJobCost({
    jobId: params.jobId,
    description: params.description,
    amountNet: params.amountPence,
    category: params.category,
    incurredOn: params.incurredOn,
    source: "voice",
    counterpartyName: params.counterpartyName ?? undefined,
    vatTreatment: "standard", // Default VAT treatment
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: true,
    jobId: params.jobId,
  };
}

/**
 * Cross-job cost capture: match the job from a spoken reference,
 * then save the cost.
 */
export async function completeCrossJobCost(params: {
  spokenJobRef: string;
  amountPence: number;
  counterpartyName: string | null;
  category: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  description: string;
  incurredOn: string;
  transcriptExcerpt?: string;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) throw new Error("Contractor not found");

  // Fetch contractor's jobs for matching
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, customer_name, job_reference, updated_at")
    .eq("contractor_id", contractor.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  const jobsList = jobs ?? [];

  const matchResult = matchJobBySpokenReference(
    params.spokenJobRef,
    jobsList.map((j) => ({
      id: j.id,
      customer_name: j.customer_name,
      job_reference: j.job_reference,
      updated_at: j.updated_at,
    })),
  );

  if (matchResult === null) {
    throw new Error(
      `No job found matching "${params.spokenJobRef}". Create the job first, then add costs to it.`,
    );
  }

  if (matchResult === "ambiguous") {
    throw new Error(
      `Multiple jobs match "${params.spokenJobRef}". Be more specific (use the job reference like MK-1234).`,
    );
  }

  // Create the cost
  const result = await completeCostCapture({
    jobId: matchResult.id,
    amountPence: params.amountPence,
    counterpartyName: params.counterpartyName,
    category: params.category,
    description: params.description,
    incurredOn: params.incurredOn,
    transcriptExcerpt: params.transcriptExcerpt,
  });

  // Redirect to the job page with confirmation
  redirect(`/jobs/${result.jobId}?cost_added=voice`);
}
