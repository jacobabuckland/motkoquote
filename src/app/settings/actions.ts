"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
