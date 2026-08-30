"use server";

import { createClient } from "@/lib/supabase/server";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { buildCostIntakeInstructions, COST_INTAKE_TOOLS } from "@/lib/voice/cost-intake-prompt";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { createJobCost } from "@/app/jobs/[id]/cost-actions";

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
  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, created_at, customer:customers(name)")
    .eq("contractor_id", contractor.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (jobsError) {
    throw jobsError;
  }

  const jobsList = jobs ?? [];

  const instructions = buildCostIntakeInstructions({
    contractorName: contractor.company_name,
    jobs: jobsList.map((j) => {
      // PostgREST returns to-one relations as arrays; cast to help TypeScript
      const customer = j.customer as unknown as Array<{ name: string }> | { name: string } | null;
      const customerName = Array.isArray(customer)
        ? customer[0]?.name ?? "(no customer)"
        : customer?.name ?? "(no customer)";

      return {
        id: j.id,
        created_at: j.created_at,
        customer_name: customerName,
      };
    }),
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
  amountWords: string;
  counterpartyName: string | null;
  category: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  description: string;
  incurredOn: string;
}): Promise<{ success: boolean; jobId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  // Validate the job exists and belongs to this contractor.
  //
  // Only id and contractor_id are read. customer_name and job_reference were
  // named here and never used, and `jobs` has neither — so PostgREST rejected
  // the select, `job` came back null, and this threw "Job not found" for a job
  // that exists.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, contractor_id")
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

  // Parse the amount using the deterministic parser as the single source of truth
  const amountPence = parseSpokenMoneyAmount(params.amountWords);

  if (amountPence === null) {
    throw new Error(
      `Could not parse amount from spoken words: "${params.amountWords}"`,
    );
  }

  // Validate the parsed amount is within acceptable range
  if (amountPence <= 0 || amountPence > 1_000_000_00) {
    throw new Error("Amount must be between £0.01 and £1,000,000");
  }

  // Create the cost using the existing createJobCost action
  const result = await createJobCost({
    jobId: params.jobId,
    description: params.description,
    amountNet: amountPence,
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

