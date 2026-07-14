"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendAccountDeletionEmail } from "@/lib/email";
import {
  notificationEvents,
  type NotificationEvent,
} from "@/lib/schemas/notification";

// How long a soft-deleted account is retained before its personal data is
// purged. The contractor can sign back in and cancel any time inside this window.
const PURGE_GRACE_DAYS = 30;

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

// Soft-deletes the signed-in contractor's account: flags it, schedules the
// 30-day purge, emails a confirmation, then signs them out. Reversible until
// the purge date via cancelAccountDeletion. The actual data removal happens in
// the purge cron, not here.
export const requestAccountDeletion = async (): Promise<void> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  const { data: contractor } = await supabase
    .from("contractors")
    .update({ deleted_at: now.toISOString(), purge_after: purgeAfter.toISOString() })
    .eq("owner_user_id", user.id)
    .select("business_profile")
    .maybeSingle();

  const profile = contractor?.business_profile as
    | { business_email?: string | null }
    | null;
  const to = profile?.business_email ?? user.email;
  if (to) {
    await sendAccountDeletionEmail({
      to,
      purgeDate: purgeAfter.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    });
  }

  await supabase.auth.signOut();
  redirect("/login");
};

// Cancels a pending deletion, restoring the account. Available to a contractor
// who signed back in during the grace period.
export const cancelAccountDeletion = async (): Promise<void> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("contractors")
    .update({ deleted_at: null, purge_after: null })
    .eq("owner_user_id", user.id);

  revalidatePath("/settings");
};
