import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CostIntake } from "@/components/voice/cost-intake";
import type { CostIntakeAdapter, DraftedCost } from "@/components/voice/cost-intake-adapter";
import { createCostRealtimeSession, completeCostCapture } from "@/app/costs/actions";

/**
 * Job-scoped voice cost entry page.
 *
 * The contractor is already on a specific job page and wants to add a cost
 * by voice. The job is known upfront, so no matching is needed.
 *
 * Route: /jobs/[id]/add-cost-voice
 */

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AddCostVoicePage({ params }: PageProps) {
  const resolvedParams = await params;
  const jobId = resolvedParams.id;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verify the job exists and belongs to this contractor
  const { data: job } = await supabase
    .from("jobs")
    .select("id, customer_name, job_reference, contractor_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) redirect("/jobs");

  // Verify ownership via contractor
  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor || job.contractor_id !== contractor.id) {
    redirect("/jobs");
  }

  // Server action to save the drafted cost (job-scoped)
  async function completeCost(draft: DraftedCost) {
    "use server";
    const result = await completeCostCapture({
      jobId,
      amountPence: draft.amountPence,
      counterpartyName: draft.counterpartyName,
      category: draft.category,
      description: draft.description,
      incurredOn: draft.incurredOn,
    });
    // Redirect to the job page with confirmation
    redirect(`/jobs/${result.jobId}?cost_added=voice`);
  }

  const adapter: CostIntakeAdapter = {
    startSession: createCostRealtimeSession,
    complete: completeCost,
    backHref: `/jobs/${jobId}`,
    backLabel: "Back to job",
    failureBody: "The cost wasn't saved — try again or add it manually.",
  };

  return <CostIntake adapter={adapter} />;
}
