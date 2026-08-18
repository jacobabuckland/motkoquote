import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CostIntake } from "@/components/voice/cost-intake";
import type { CostIntakeAdapter, DraftedCost } from "@/components/voice/cost-intake-adapter";
import { createCostRealtimeSession, completeCostCapture } from "@/app/costs/actions";

/**
 * Cross-job voice cost entry page.
 *
 * Reached from the "Speak to motko" hub. The contractor captures a cost
 * by voice and the job is matched from their spoken reference.
 *
 * Route: /costs/voice
 */

export default async function CostVoicePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Verify contractor exists
  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) {
    redirect(user.user_metadata?.setup_incomplete ? "/setup/voice" : "/setup");
  }

  // Server action to save the drafted cost (cross-job)
  async function completeCost(draft: DraftedCost) {
    "use server";
    // The job was matched during the voice session and is in draft.jobId
    const result = await completeCostCapture({
      jobId: draft.jobId,
      amountPence: draft.amountPence,
      counterpartyName: draft.counterpartyName,
      category: draft.category,
      description: draft.description,
      incurredOn: draft.incurredOn,
      transcriptExcerpt: draft.amountWords,
    });
    // Redirect to the job page with confirmation
    redirect(`/jobs/${result.jobId}?cost_added=voice`);
  }

  const adapter: CostIntakeAdapter = {
    startSession: createCostRealtimeSession,
    complete: completeCost,
    backHref: "/motko",
    backLabel: "Back",
    failureBody: "The cost wasn't saved — try again or add it manually from the job page.",
  };

  return <CostIntake adapter={adapter} />;
}
