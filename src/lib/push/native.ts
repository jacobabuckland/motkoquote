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
// Latest tap-to-open handler; the listener reads this so the most recent caller
// (launch init or Settings) wins without re-attaching duplicate listeners.
let openUrlHandler: ((url: string) => void) | null = null;

// The APNs device token from the most recent successful registration, so a
// later "turn notifications off" can tell the server which row to drop.
export const getNativeDeviceToken = (): string | null => lastDeviceToken;

// Attaches the token + tap listeners exactly once. Safe to call on every app
// launch; it never triggers the OS permission prompt (that's register()'s job).
const ensureHandlers = async (): Promise<void> => {
  if (handlersAttached) return;
  handlersAttached = true;

  const { PushNotifications } = await import("@capacitor/push-notifications");

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
      if (url && openUrlHandler) openUrlHandler(url);
    },
  );
};

// Launch-time init: wires notification-tap navigation without prompting for
// permission. Call once when the native shell mounts. No-op on the web.
export const initNativePush = async (
  onOpenUrl: (url: string) => void,
): Promise<void> => {
  if (!isNativeApp()) return;
  openUrlHandler = onOpenUrl;
  try {
    await ensureHandlers();
  } catch {
    // Best-effort; the app still works without native push.
  }
};

// Registers this device for APNs and persists the token server-side, prompting
// for the OS permission if needed. Trigger this contextually (Settings button),
// not on cold launch. Idempotent — the delete-then-insert upsert in the
// subscribe route keeps one row per token.
export const registerNativePush = async (
  onOpenUrl?: (url: string) => void,
): Promise<NativeRegisterResult> => {
  if (!isNativeApp()) return { status: "not-native" };
  if (onOpenUrl) openUrlHandler = onOpenUrl;

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await ensureHandlers();

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
