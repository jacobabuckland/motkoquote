"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// The business-level rates a quote is priced from. Every one is optional: a
// trade who does not do half days, does not charge travel, or does not mark
// materials up has no answer to give, and an invented default would show up on
// a customer document as a figure they never said (§5.2).
export const businessRatesSchema = z.object({
  day_rate: z.coerce.number().nonnegative().nullable(),
  half_day_rate: z.coerce.number().nonnegative().nullable(),
  overtime_rate: z.coerce.number().nonnegative().nullable(),
  callout_min: z.coerce.number().nonnegative().nullable(),
  travel_rate: z.coerce.number().nonnegative().nullable(),
  markup_pct: z.coerce.number().min(0).max(100).nullable(),
});

export type BusinessRates = z.infer<typeof businessRatesSchema>;

/**
 * Persists the trade's rates from Settings.
 *
 * These have been captured at onboarding since migration 1 and read by the
 * drafting compiler ever since, but there was no way to CHANGE one afterwards —
 * a rate set once in a voice interview was set for good. A trade who put their
 * rate up had no route to say so, which quietly made every later quote wrong.
 */
export const saveBusinessRates = async (
  input: BusinessRates,
): Promise<{ ok: true } | { error: string }> => {
  const parsed = businessRatesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check those figures." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You're not signed in." };

  const { error } = await supabase
    .from("contractors")
    .update(parsed.data)
    .eq("owner_user_id", user.id);

  // Checked, not assumed. An unchecked write here would report "Saved" over a
  // rate that never changed — the same shape of defect as the erasure bug.
  if (error) return { error: "Couldn't save those rates. Try again." };

  revalidatePath("/settings");
  return { ok: true };
};
