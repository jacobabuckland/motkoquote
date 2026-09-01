"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAccountDeletionEmail } from "@/lib/email";
import {
  checkErasurePreconditions,
  eraseAccount,
  type ErasureResult,
} from "@/lib/account-erasure";
import {
  notificationEvents,
  type NotificationEvent,
} from "@/lib/schemas/notification";

// Persists the contractor's muted notification events. Called from the Settings
// toggles: the client sends the full set of currently-muted event ids and we
// upsert the single preferences row for the signed-in user. RLS keeps the write
// scoped to their own row.
export const saveNotificationPreferences = async (
  disabledEvents: NotificationEvent[],
): Promise<void> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  // Guard against anything not in our known event set before it hits the DB.
  const clean = disabledEvents.filter((e) =>
    (notificationEvents as readonly string[]).includes(e),
  );

  await supabase.from("notification_preferences").upsert(
    {
      user_id: user.id,
      disabled_events: clean,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  revalidatePath("/settings");
};

/**
 * Erases the signed-in contractor's account, immediately and for good.
 *
 * What this replaced is worth stating, because the replacement is the fix: it
 * used to write a `deleted_at` flag, schedule a purge 30 days out and sign the
 * contractor out. It never touched the Supabase auth user, and no read path
 * anywhere consulted the flag — so the account stayed live. On 2026-09-01 an
 * account "deleted" at 07:14 signed back in with the same password at 07:36,
 * and re-signing-up with its address hit Supabase's existing-user path, which
 * returns a success-shaped response and sends no confirmation email. One bug,
 * two symptoms.
 *
 * There is no grace period and no restore. The two-step confirmation in the UI
 * says plainly that this cannot be undone, and it means it.
 *
 * Returns a result rather than redirecting on failure: a deletion that could
 * not complete has to say so out loud, with the account left intact and usable.
 * Only the success path redirects.
 */
export const requestAccountDeletion = async (): Promise<ErasureResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "not_authenticated", message: "You're not signed in." };
  }

  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .select("id, stripe_account_id, business_profile")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // A read failure here is NOT "no account". Treating it as one would erase the
  // auth user of an account whose data we never managed to look at.
  if (contractorError) {
    return {
      ok: false,
      code: "data_erase_failed",
      message: "We couldn't load your account just now. Nothing has been deleted — please try again.",
    };
  }

  const stripeAccountId = (contractor?.stripe_account_id as string | null) ?? null;

  // D5 — money still in flight is the only thing that blocks. Checked before a
  // single row is touched, so a block leaves the account exactly as it was.
  const preconditions = await checkErasurePreconditions(stripeAccountId);
  if (!preconditions.ok) return preconditions;

  // The farewell email goes BEFORE erasure, because afterwards there is no
  // address left to send it to. Its delivery is not allowed to block the
  // erasure — a bounced email is a worse reason to keep someone's data than no
  // reason at all.
  const profile = contractor?.business_profile as { business_email?: string | null } | null;
  const to = profile?.business_email ?? user.email;
  if (to) {
    await sendAccountDeletionEmail({ to });
  }

  const result = await eraseAccount(createAdminClient(), {
    userId: user.id,
    contractorId: (contractor?.id as string | undefined) ?? null,
    stripeAccountId,
  });

  if (!result.ok) return result;

  // Sessions are already dead — deleting the auth user revokes every refresh
  // token it held — but the cookie jar on THIS device still holds the stale
  // pair, and a signOut is what clears it.
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
};
