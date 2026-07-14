import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPush } from "@/lib/push/web";
import { sendApns } from "@/lib/push/apns";
import type { PushPayload } from "@/lib/push/payload";

export type { PushPayload } from "@/lib/push/payload";

type SubscriptionRow = {
  id: string;
  platform: "webpush" | "apns";
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  device_token: string | null;
};

// Fans a single notification out to every device a contractor has registered,
// respecting their muted-event preferences and pruning any subscription the
// push service reports as permanently gone. Runs with the service-role client
// (webhook / server-action contexts) so it can read across users and delete
// dead rows. Best-effort throughout: a delivery failure never throws, so the
// customer action that triggered it (signing, paying) is never blocked.
export const sendPushToUser = async (
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<void> => {
  // A real event can be muted; the "test" payload always goes through so the
  // Settings "Send test notification" button is a reliable check.
  if (payload.event !== "test") {
    const { data: prefs } = await admin
      .from("notification_preferences")
      .select("disabled_events")
      .eq("user_id", userId)
      .maybeSingle();
    const disabled = (prefs?.disabled_events as string[] | undefined) ?? [];
    if (disabled.includes(payload.event)) return;
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, platform, endpoint, p256dh, auth, device_token")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return;

  // Group a job's alerts in the iOS tray by the deep-link target.
  const threadId = payload.url;
  const goneIds: string[] = [];

  await Promise.all(
    (subs as SubscriptionRow[]).map(async (sub) => {
      if (sub.platform === "webpush") {
        if (!sub.endpoint || !sub.p256dh || !sub.auth) return;
        const result = await sendWebPush(
          { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
          payload,
        );
        if (result.gone) goneIds.push(sub.id);
      } else {
        if (!sub.device_token) return;
        const result = await sendApns(sub.device_token, payload, threadId);
        if (result.gone) goneIds.push(sub.id);
      }
    }),
  );

  if (goneIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", goneIds);
  }
};
