import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CostIntake } from "@/components/voice/cost-intake";
import type { CostIntakeAdapter, DraftedCost } from "@/components/voice/cost-intake-adapter";

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

  // Server action to create the Realtime session
  async function startSession() {
    "use server";
    // In a full implementation, this would:
    // 1. Call OpenAI to create a Realtime session
    // 2. Return the client secret and session key
    // For now, return placeholder values
    return {
      sessionKey: null,
      clientSecret: "",
    };
  }

  // Server action to save the drafted cost
  async function completeCost(_draft: DraftedCost) {
    "use server";
    // In a full implementation, this would:
    // 1. Match the job from _draft.jobId
    // 2. Validate the draft
    // 3. Call createJobCost server action
    // 4. Navigate to job page with confirmation
    // For now, placeholder
  }

  const adapter: CostIntakeAdapter = {
    startSession,
    complete: completeCost,
    backHref: "/motko",
    backLabel: "Back",
    failureBody: "The cost wasn't saved — try again or add it manually from the job page.",
  };

  return <CostIntake adapter={adapter} />;
}
