import type { NotificationEvent } from "@/lib/schemas/notification";

// Billing/operational alerts about the trade's OWN motko account (fee
// collection). Deliberately NOT part of notificationEvents: they're never shown
// as a mutable Settings toggle and never appear in disabled_events, so — unlike
// customer-action events — they always deliver. A trade can't opt out of being
// told their fee payment failed.
export type FeeBillingEvent =
  | "fee_collection_failed"
  | "fee_billing_paused"
  | "mandate_setup_required";

// The shape every channel serialises. `url` is the in-app deep link the tap
// should open (e.g. /jobs/<id>); the service worker and the iOS app both read
// it off the notification data to route the contractor straight to the job.
export type PushPayload = {
  event: NotificationEvent | "test" | FeeBillingEvent;
  title: string;
  body: string;
  url: string;
};
