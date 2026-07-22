"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createTrueLayerMandate } from "@/lib/truelayer-vrp";
import { buildMandateHostedPageUrl, getTrueLayerConfig } from "@/lib/truelayer";

// Starts commercial-VRP mandate setup so motko can collect accrued fees. Creates
// the mandate with TrueLayer, stashes its id + status on the contractor, and
// returns the hosted-page URL the client redirects the trade to for bank
// authorisation. On return, the webhook / a status re-check flips
// fee_mandate_status to 'authorized' and the monthly batch can charge it.
export const startFeeMandate = async (): Promise<
  { hostedPageUrl: string } | { error: string }
> => {
  const config = getTrueLayerConfig();
  if (!config) return { error: "Fee billing isn't available yet." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name, business_profile")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (!contractor) return { error: "Set up your account first." };

  const email =
    (contractor.business_profile as { business_email?: string } | null)
      ?.business_email ?? user.email;

  let mandate;
  try {
    mandate = await createTrueLayerMandate({
      user: {
        id: contractor.id,
        name: contractor.company_name ?? "Trade",
        ...(email ? { email } : {}),
      },
      metadata: { contractor_id: contractor.id },
    });
  } catch {
    return { error: "Couldn't start fee billing setup. Try again." };
  }

  const { error } = await supabase
    .from("contractors")
    .update({ fee_mandate_id: mandate.id, fee_mandate_status: mandate.status })
    .eq("owner_user_id", user.id);
  if (error) return { error: "Couldn't save fee billing setup. Try again." };

  const returnUri = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/settings?mandate=done`;
  const hostedPageUrl = buildMandateHostedPageUrl(
    config.env,
    { id: mandate.id, resourceToken: mandate.resourceToken },
    returnUri,
  );

  revalidatePath("/settings");
  return { hostedPageUrl };
};
