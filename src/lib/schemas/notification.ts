import { z } from "zod";

// The contractor-facing events that can raise a push notification. These are
// the six "money moments" in a job's life — the points where the customer has
// taken an action the contractor needs to know about immediately. Each id is
// stable and stored verbatim in `notification_preferences.disabled_events`, so
// never rename one without a migration.
export const notificationEvents = [
  "quote_accepted",
  "quote_declined",
  "contract_signed",
  "contract_declined",
  "deposit_paid",
  "final_paid",
] as const;

export const notificationEventSchema = z.enum(notificationEvents);
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

// Human-readable labels for the Settings toggles. Keyed by event id so the UI
// and the preference storage share one source of truth.
export const notificationEventLabels: Record<NotificationEvent, string> = {
  quote_accepted: "Quote accepted",
  quote_declined: "Quote declined",
  contract_signed: "Contract signed",
  contract_declined: "Contract declined",
  deposit_paid: "Deposit paid",
  final_paid: "Final payment received",
};

// The two delivery channels a subscription can use. `webpush` is VAPID browser
// push (serves current web users today); `apns` is the native iOS path once the
// App Store build ships.
export const pushPlatformSchema = z.enum(["webpush", "apns"]);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

// Payload the client sends to register (or re-register) a browser for web push.
// The keys come straight off a PushSubscription's getKey() output.
export const webPushSubscriptionInputSchema = z.object({
  platform: z.literal("webpush"),
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

// Payload a native iOS client sends to register its APNs device token.
export const apnsSubscriptionInputSchema = z.object({
  platform: z.literal("apns"),
  device_token: z.string().min(1),
});

export const pushSubscriptionInputSchema = z.discriminatedUnion("platform", [
  webPushSubscriptionInputSchema,
  apnsSubscriptionInputSchema,
]);
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>;

// The preference update the Settings page posts: the full set of muted events.
export const notificationPreferencesInputSchema = z.object({
  disabled_events: z.array(notificationEventSchema),
});
export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesInputSchema
>;
