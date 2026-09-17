"use server";

import { createClient } from "@/lib/supabase/server";
import type { JobSummary } from "@/lib/match-job";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { buildCostIntakeInstructions, COST_INTAKE_TOOLS } from "@/lib/voice/cost-intake-prompt";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { readAmountPhrase } from "@/lib/voice/draft-cost";
import { createJobCost } from "@/app/jobs/[id]/cost-actions";
import {
  AMBIGUOUS_BASIS_QUESTION,
  resolveCostBasis,
  type AmountBasis,
  type CostVatTreatment,
} from "@/lib/cost-vat-basis";
import { actionableError } from "@/lib/actionable-error";

const REALTIME_TOOLS: RealtimeToolDef[] = COST_INTAKE_TOOLS;

export type CostRealtimeSessionResult = {
  sessionKey: string | null;
  clientSecret: string;
  /**
   * The contractor's jobs, for the DETERMINISTIC matcher (#274).
   *
   * Returned rather than kept server-side because the match happens client-side
   * in the tool handler, alongside the money parse, and for the same reason:
   * the model supplies the contractor's words and code decides what they mean.
   * No new query — these rows are already loaded to build the prompt.
   */
  jobs: JobSummary[];
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

  const jobSummaries = jobsList.map((j) => {
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
  });

  const instructions = buildCostIntakeInstructions({
    contractorName: contractor.company_name,
    jobs: jobSummaries,
  });

  const clientSecret = await createRealtimeClientSecret({
    instructions,
    tools: REALTIME_TOOLS,
  });

  return {
    sessionKey: null,
    clientSecret,
    jobs: jobSummaries,
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
  // All four optional so every existing caller keeps its behaviour, and absent
  // lands on the honest answer rather than a confident wrong one: basis
  // "unknown" with no VAT records the figure as given and the treatment as
  // unknown, which is the enum's default and what it is for.
  amountBasis?: AmountBasis;
  vatAmountWords?: string | null;
  vatTreatment?: CostVatTreatment;
  paid?: boolean | null;
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

  // Parse the amount using the deterministic parser as the single source of
  // truth -- THE SAME READER THE DRAFT USED.
  //
  // This said `parseSpokenMoneyAmount` and the draft said `readAmountPhrase`,
  // and the two disagreed about exactly the phrases #811 had just taught the
  // draft to understand. "GBP 45.50 including VAT" built a correct draft, showed
  // a correct review screen with the net and the VAT on it, and then threw HERE
  // on Confirm and Save: HTTP 500, no record. Scenario 105 of the 17 Sep
  // re-run, which had passed before #811 -- the loop it removed was replaced by
  // a failure one screen later, which is worse, because the contractor watched
  // the right numbers appear and lose them.
  //
  // The client sends intent and the server stays the authority; that is
  // unchanged. Being the authority means reading the same words the same way,
  // not reading them a second way.
  const { pence: amountPence, basis: basisFromWords } = readAmountPhrase(
    params.amountWords,
  );

  if (amountPence === null) {
    throw new Error(
      `Could not parse amount from spoken words: "${params.amountWords}"`,
    );
  }

  // Validate the parsed amount is within acceptable range
  if (amountPence <= 0 || amountPence > 1_000_000_00) {
    throw new Error("Amount must be between £0.01 and £1,000,000");
  }

  // THE VAT AMOUNT, PARSED THE SAME WAY THE TOTAL IS. A second spoken figure
  // gets the same deterministic treatment as the first — never the model's
  // arithmetic, and never a number it authored.
  const statedVatPence =
    params.vatAmountWords && params.vatAmountWords.trim().length > 0
      ? parseSpokenMoneyAmount(params.vatAmountWords)
      : null;

  // Net, VAT and treatment from what was actually said. Refuses rather than
  // guessing when the basis is the missing piece — see cost-vat-basis.ts.
  const basis = resolveCostBasis({
    amountPence,
    // Same precedence as the draft: what the caller REPORTED wins, and the
    // contractor's own words only fill a gap it left.
    basis:
      params.amountBasis && params.amountBasis !== "unknown"
        ? params.amountBasis
        : (basisFromWords ?? "unknown"),
    treatment: params.vatTreatment ?? "unknown",
    statedVatPence,
  });

  if (!basis.ok) {
    throw actionableError(AMBIGUOUS_BASIS_QUESTION);
  }

  // Create the cost using the existing createJobCost action
  const result = await createJobCost({
    jobId: params.jobId,
    description: params.description,
    amountNet: basis.amountNet,
    vatAmount: basis.vatAmount,
    vatTreatment: basis.vatTreatment,
    // Only ever what they SAID. Null means unstated, and the schema's own
    // default (false) then applies — the same answer, arrived at honestly.
    ...(params.paid == null ? {} : { paid: params.paid }),
    ...(params.paid === true ? { paidOn: params.incurredOn } : {}),
    category: params.category,
    incurredOn: params.incurredOn,
    source: "voice",
    counterpartyName: params.counterpartyName ?? undefined,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    success: true,
    jobId: params.jobId,
  };
}

