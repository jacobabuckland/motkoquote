"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { payoutDetailsSchema } from "@/lib/schemas/payout";

// Saves the trade's own bank account for pay-by-bank settlement. Funds land
// here directly (no merchant account / payout step), so completing this is what
// gates the customer pay page — create-payment refuses until it's set. Flipping
// payout_details_complete is the single readiness signal both the pay route and
// the dashboard read.
export const savePayoutDetails = async (
  raw: unknown,
): Promise<{ ok: true } | { error: string }> => {
  const parsed = payoutDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your bank details." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("contractors")
    .update({
      payout_account_holder_name: parsed.data.account_holder_name,
      payout_sort_code: parsed.data.sort_code,
      payout_account_number: parsed.data.account_number,
      payout_details_complete: true,
    })
    .eq("owner_user_id", user.id);

  if (error) return { error: "Couldn't save your bank details. Try again." };

  revalidatePath("/settings");
  return { ok: true };
};
