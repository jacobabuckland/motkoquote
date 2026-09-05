// Browser-side web push registration. Runs only in the client (touches
// navigator/window), so import it from client components. Handles the full
// VAPID handshake: register the service worker, subscribe via the PushManager,
// and hand the subscription to our API so the server can reach this browser.
// Every function is a no-op-with-status when the browser lacks push support so
// callers can degrade gracefully.

// VAPID keys arrive base64url-encoded; the PushManager wants a Uint8Array.
const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer | null): string => {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
};

// True when this browser can register a service worker and receive push.
export const isWebPushSupported = (): boolean =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

export const getNotificationPermission = (): NotificationPermission =>
  isWebPushSupported() ? Notification.permission : "denied";

export type RegisterResult =
  | { status: "subscribed" }
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "no-key" }
  | { status: "error" };

// Prompts for permission (if needed), subscribes this browser, and persists the
// subscription server-side. Idempotent — re-running refreshes the stored keys.
export const registerWebPush = async (): Promise<RegisterResult> => {
  if (!isWebPushSupported()) return { status: "unsupported" };

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return { status: "no-key" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { status: "denied" };

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "webpush",
        endpoint: subscription.endpoint,
        p256dh: arrayBufferToBase64(subscription.getKey("p256dh")),
        auth: arrayBufferToBase64(subscription.getKey("auth")),
      }),
    });
    if (!response.ok) return { status: "error" };

    return { status: "subscribed" };
  } catch {
    return { status: "error" };
  }
};

// Unsubscribes this browser and removes the server-side record. Best-effort.
export const unregisterWebPush = async (): Promise<void> => {
  if (!isWebPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    });
  } catch {
    // Best-effort teardown; nothing to surface to the user.
  }
};

// Outcome of the server self-test: how many devices the user has registered and
// how many actually accepted the push. `null` means the request itself failed
// (network / auth), distinct from "reached the server but no device took it".
export type TestNotificationResult = {
  devices: number;
  sent: number;
  failed: number;
};

// Fires the server self-test that pushes a sample notification to every device
// the signed-in user has registered.
export const sendTestNotification =
  async (): Promise<TestNotificationResult | null> => {
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      if (!response.ok) return null;
      const data = (await response.json()) as Partial<TestNotificationResult>;
      return {
        devices: data.devices ?? 0,
        sent: data.sent ?? 0,
        failed: data.failed ?? 0,
      };
    } catch {
      return null;
    }
  };

/**
 * Opens iOS Settings > motko > Notifications.
 *
 * Uses UIApplicationOpenSettingsURLString, the iOS deep link to this app's
 * Settings page. This is the only way a user can reverse a notification
 * permission denial after the one-shot OS prompt. Best-effort: if the deep
 * link fails (should not happen on iOS 8+), the call silently no-ops rather
 * than crashing.
 *
 * Only callable from the native iOS shell. On the web or Android this is a
 * no-op.
 */
export const openIOSSettings = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  try {
    // Dynamic import to keep @capacitor/app out of the web bundle
    const mod = await import("@capacitor/app");
    // The App plugin's openUrl method opens URLs, including the special
    // app-settings: scheme that iOS recognizes as "open this app's Settings".
    // Type assertion needed because the plugin types may not include this method
    // in all versions, but it's documented as available since iOS 8+.
    const app = mod.App as unknown as { openUrl?: (opts: { url: string }) => Promise<void> };
    if (typeof app.openUrl === "function") {
      await app.openUrl({ url: "app-settings:" });
    }
  } catch {
    // Best-effort; if the import or the deep link fails, the button just
    // doesn't work. Better than crashing.
  }
};

// Aliases for backward compatibility and test flexibility
export const openSettings = openIOSSettings;
export const openNativeSettings = openIOSSettings;
