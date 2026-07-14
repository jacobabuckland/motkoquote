// Native (Capacitor/iOS) push registration — the APNs counterpart to the VAPID
// web-push client in `client.ts`. Runs only inside the native shell; on the web
// every entry point short-circuits via isNativeApp() so this never touches the
// browser bundle's critical path. The @capacitor/push-notifications plugin is
// dynamically imported so it stays out of the web build entirely.
//
// Flow: check/request the OS notification permission, call register() (which
// asks APNs for a device token), and when the 'registration' event fires, POST
// the token to /api/push/subscribe as { platform: "apns", device_token }. That
// closes the loop with the APNs send path (src/lib/push/apns.ts).

import { isNativeApp } from "@/lib/platform";

export type NativeRegisterResult =
  | { status: "registered" }
  | { status: "not-native" }
  | { status: "denied" }
  | { status: "error" };

let handlersAttached = false;
let lastDeviceToken: string | null = null;

// The APNs device token from the most recent successful registration, so a
// later "turn notifications off" can tell the server which row to drop.
export const getNativeDeviceToken = (): string | null => lastDeviceToken;

// Registers this device for APNs and persists the token server-side. Idempotent
// — the delete-then-insert upsert in the subscribe route keeps one row per
// token. `onOpenUrl` is invoked when the contractor taps a notification, with
// the deep-link URL carried in the payload (see apns.ts).
export const registerNativePush = async (
  onOpenUrl?: (url: string) => void,
): Promise<NativeRegisterResult> => {
  if (!isNativeApp()) return { status: "not-native" };

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    if (!handlersAttached) {
      handlersAttached = true;

      await PushNotifications.addListener("registration", (token) => {
        lastDeviceToken = token.value;
        void fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: "apns", device_token: token.value }),
        });
      });

      await PushNotifications.addListener("registrationError", () => {
        // Best-effort; a failed token exchange leaves web push as the fallback.
      });

      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          const url = (action.notification.data as { url?: string } | undefined)?.url;
          if (url && onOpenUrl) onOpenUrl(url);
        },
      );
    }

    const current = await PushNotifications.checkPermissions();
    let receive = current.receive;
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      receive = (await PushNotifications.requestPermissions()).receive;
    }
    if (receive !== "granted") return { status: "denied" };

    await PushNotifications.register();
    return { status: "registered" };
  } catch {
    return { status: "error" };
  }
};

// Removes this device's APNs subscription server-side. Best-effort; uses the
// token captured at registration unless an explicit one is passed.
export const unregisterNativePush = async (
  deviceToken?: string,
): Promise<void> => {
  const token = deviceToken ?? lastDeviceToken;
  if (!token) return;
  try {
    await fetch(
      `/api/push/subscribe?device_token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
  } catch {
    // Best-effort teardown; nothing to surface to the user.
  }
};
