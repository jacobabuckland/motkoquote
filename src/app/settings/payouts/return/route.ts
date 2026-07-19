import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { retrieveConnectStatus } from "@/lib/stripe";

// Where Stripe sends the tradesperson after hosted onboarding. The account.updated
// webhook is the source of truth for status, but it can lag a second or two — so
// we also pull the status here and persist it before redirecting, making the
// Settings page reflect the result immediately.
export const GET = async (request: NextRequest) => {
  const settings = new URL("/settings", request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: contractor } = await supabase
    .from("contractors")
    .select("stripe_account_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const accountId = contractor?.stripe_account_id as string | null | undefined;
  if (accountId) {
    const status = await retrieveConnectStatus(accountId);
    if (status) {
      await supabase
        .from("contractors")
        .update({
          stripe_charges_enabled: status.chargesEnabled,
          stripe_payouts_enabled: status.payoutsEnabled,
          stripe_requirements_due: status.requirementsDue,
        })
        .eq("owner_user_id", user.id);
    }
  }

  return NextResponse.redirect(settings);
};
