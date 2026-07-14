import type { NotificationEvent } from "@/lib/schemas/notification";

// The shape every channel serialises. `url` is the in-app deep link the tap
// should open (e.g. /jobs/<id>); the service worker and the iOS app both read
// it off the notification data to route the contractor straight to the job.
export type PushPayload = {
  event: NotificationEvent | "test";
  title: string;
  body: string;
  url: string;
};
