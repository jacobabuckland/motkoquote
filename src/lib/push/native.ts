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
//
// register() resolving proves nothing — it only asks iOS to start the exchange.
// So registerNativePush waits for that whole round trip to finish and reports
// what actually happened, rather than claiming success the moment the plugin
// call returns. Anything else lets a dropped token or a rejected save show the
// contractor "Notifications enabled on this device" while zero devices exist.

import { isNativeApp } from "@/lib/platform";

export type NativeRegisterResult =
  | { status: "registered" }
  | { status: "not-native" }
  | { status: "denied" }
  // The token round trip did not finish within REGISTRATION_TIMEOUT_MS. A
  // genuine APNs rejection settles as 'error' via the registrationError
  // listener, so this is specifically "nothing came back in time" — a dead
  // network, or the native side never answering at all (the AppDelegate
  // remote-notification bridge missing, or no push entitlement on the build).
  | { status: "no-token" }
  // This attempt was abandoned because a newer one started — the contractor
  // tapped twice. NOT a failure, and it must never reach the user: the newer
  // attempt owns the outcome. It exists as its own status because it used to
  // settle as 'no-token', which made a double-tap toast a token failure for an
  // attempt that may well have gone on to succeed.
  | { status: "superseded" }
  // Token arrived, but /api/push/subscribe refused it (auth, network, 5xx).
  | { status: "save-failed" }
  | { status: "error" };

// How long to wait for the token round trip before calling it a failure. APNs
// answers in well under a second on a live network; this is a backstop so the
// button can never hang.
//
// Declared above the copy map because the map interpolates it — a `const` used
// earlier in the file than it is declared works here only because the map is a
// function called later, which is a temporal-dead-zone trap waiting for the
// first person to inline it.
const REGISTRATION_TIMEOUT_MS = 10_000;

/**
 * Short codes a contractor can read down the phone.
 *
 * The point is that support can tell these three apart without the contractor
 * describing anything: PUSH-NT is "Apple never answered" (provisioning), PUSH-SV
 * is "Apple answered, our server refused it", PUSH-ER is "something threw". They
 * used to be indistinguishable in a support conversation, which is how a
 * provisioning problem spent days being treated as a connectivity one.
 */
export const DIAGNOSTIC_CODE = {
  noToken: "PUSH-NT",
  saveFailed: "PUSH-SV",
  error: "PUSH-ER",
} as const;

/**
 * What the contractor is told for each registration outcome, or null when they
 * are told nothing.
 *
 * Lives here rather than inline in the Settings client so the copy and the
 * result union have ONE definition between them. A test that mirrors the map
 * can pass while the screen says something else; a test that imports it cannot.
 */
export const nativeRegisterMessage = (
  status: NativeRegisterResult["status"],
): string | null => {
  switch (status) {
    // The contractor tapped twice. The newer attempt owns the outcome, so this
    // one has nothing to say — reporting a failure here for a registration that
    // may be about to succeed is the most confusing thing available.
    case "superseded":
      return null;
    case "registered":
      return "Notifications enabled on this device.";
    case "not-native":
      return "Couldn't enable notifications here.";
    case "denied":
      return "Notifications are blocked — enable them in iOS Settings.";
    // Names NO cause. Two previous versions of this string each asserted one
    // and each was wrong: "update to the latest app version" (a remedy that
    // cannot work for someone already on the latest build), then "check your
    // connection" — shown on a device with full bars, Wi-Fi, 96% battery and an
    // app successfully loading fee data from the same server.
    //
    // The failure is deterministic across sessions ten hours apart on different
    // networks, so connectivity is ruled out by the evidence, not just unproven.
    // What is left is Apple-side provisioning on the App ID, which no wording
    // here can tell a contractor to fix. So it reports the state and hands them
    // something to quote instead of guessing.
    case "no-token":
      return `Couldn't set up notifications on this device. Apple didn't return a token within ${REGISTRATION_TIMEOUT_MS / 1000} seconds. Quote code ${DIAGNOSTIC_CODE.noToken} to support.`;
    case "save-failed":
      return `Your device registered, but we couldn't save it. Quote code ${DIAGNOSTIC_CODE.saveFailed} to support.`;
    case "error":
      return `Couldn't enable notifications. Quote code ${DIAGNOSTIC_CODE.error} to support.`;
  }
};

// The in-flight (or completed) listener attach. A promise rather than a
// boolean so concurrent callers share one attempt, and a failed attempt can
// clear it — see ensureHandlers.
let handlersPromise: Promise<void> | null = null;
let lastDeviceToken: string | null = null;

// The in-flight registerNativePush() call waiting on the token round trip, if
// any. The 'registration' / 'registrationError' listeners settle it, which is
// what makes the Settings toast honest.
type PendingRegistration = {
  seq: number;
  settle: (result: NativeRegisterResult) => void;
};
let pending: PendingRegistration | null = null;
// Distinguishes attempts so a timed-out attempt's timer can never settle a
// later one's promise.
let registrationSeq = 0;

const settleRegistration = (result: NativeRegisterResult): void => {
  const current = pending;
  pending = null;
  current?.settle(result);
};

// Latest tap-to-open handler; the listener reads this so the most recent caller
// (launch init or Settings) wins without re-attaching duplicate listeners.
let openUrlHandler: ((url: string) => void) | null = null;

// The APNs device token from the most recent successful registration, so a
// later "turn notifications off" can tell the server which row to drop.
export const getNativeDeviceToken = (): string | null => lastDeviceToken;

// The actual attach. Never call this directly — go through ensureHandlers,
// which dedupes concurrent callers and governs retry.
const attachHandlers = async (): Promise<void> => {
  const { PushNotifications } = await import("@capacitor/push-notifications");

  await PushNotifications.addListener("registration", (token) => {
    lastDeviceToken = token.value;
    console.info(
      `[push/native] APNs token received (${token.value.slice(0, 8)}…); persisting`,
    );
    void (async () => {
      try {
        const response = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ platform: "apns", device_token: token.value }),
        });
        if (!response.ok) {
          console.error(
            `[push/native] subscribe POST failed status=${response.status}`,
          );
        }
        settleRegistration({
          status: response.ok ? "registered" : "save-failed",
        });
      } catch (err) {
        console.error("[push/native] subscribe POST threw", err);
        settleRegistration({ status: "save-failed" });
      }
    })();
  });

  await PushNotifications.addListener("registrationError", (err) => {
    // Best-effort; a failed token exchange leaves web push as the fallback.
    console.error("[push/native] APNs registration error", err);
    settleRegistration({ status: "error" });
  });

  await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const url = (action.notification.data as { url?: string } | undefined)
        ?.url;
      if (url && openUrlHandler) openUrlHandler(url);
    },
  );
};

// Attaches the listeners exactly once. Safe to call on every app launch; it
// never triggers the OS permission prompt (that's register()'s job).
//
// Caching the attempt as a promise does two things a boolean cannot. Concurrent
// callers — launch init and the Settings button — share one attach instead of
// registering duplicate listeners; and a failed attach clears the cache so the
// next caller retries. The flag this replaced was set BEFORE the dynamic import
// and the addListener calls, so one swallowed failure at launch left the module
// looking permanently attached: register() still resolved, the APNs token
// arrived with nothing listening, and every attempt for the rest of that app
// session reported no-token.
const ensureHandlers = async (): Promise<void> => {
  if (!handlersPromise) {
    handlersPromise = attachHandlers().catch((err) => {
      handlersPromise = null;
      throw err;
    });
  }
  return handlersPromise;
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
  } catch (err) {
    // Best-effort; the app still works without native push.
    console.error("[push/native] initNativePush failed", err);
  }
};

// Registers this device for APNs and persists the token server-side, prompting
// for the OS permission if needed. Trigger this contextually (Settings button),
// not on cold launch. Idempotent — the delete-then-insert upsert in the
// subscribe route keeps one row per token.
//
// Resolves only once the device is genuinely reachable: `registered` means a
// token came back from APNs *and* the server stored it, so the caller can say
// so truthfully. Every other status names the step that failed.
/**
 * What the runtime actually looked like at the moment registration failed.
 *
 * The single most expensive unknown on this defect was whether the app was
 * genuinely native. Every failing report reached `no-token`, which is only
 * reachable if `isNativeApp()` returned true — but that is an ASSUMPTION about
 * the runtime, and a home-screen web app is exactly the case that looks native
 * to a user. Nothing in the logs distinguished "native, Apple never answered"
 * from "not really native, so of course it didn't".
 *
 * `Capacitor.isNativePlatform()` is read directly rather than through
 * isNativeApp() on purpose: isNativeApp() is the thing under suspicion, so
 * asking it whether it was right proves nothing.
 */
type RegistrationDiagnostics = {
  isNativePlatform: boolean | "unavailable";
  platform: string;
  pluginResolved: boolean;
  permission: string;
};

const gatherDiagnostics = async (
  permission: string,
): Promise<RegistrationDiagnostics> => {
  let isNativePlatform: boolean | "unavailable" = "unavailable";
  let platform = "unknown";
  try {
    const { Capacitor } = await import("@capacitor/core");
    isNativePlatform = Capacitor.isNativePlatform();
    platform = Capacitor.getPlatform();
  } catch {
    // Left as "unavailable": on the web the module may not resolve at all, and
    // that is itself the answer.
  }

  let pluginResolved = false;
  try {
    const mod = await import("@capacitor/push-notifications");
    pluginResolved = typeof mod.PushNotifications?.register === "function";
  } catch {
    pluginResolved = false;
  }

  return { isNativePlatform, platform, pluginResolved, permission };
};

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
    if (receive !== "granted") {
      console.info("[push/native] permission not granted:", receive);
      return { status: "denied" };
    }

    // Abandon any earlier attempt still waiting, so its caller can't hang. It
    // resolves as 'superseded', which the UI ignores — this attempt owns the
    // outcome now, and the abandoned one has nothing to say to the user.
    settleRegistration({ status: "superseded" });
    const seq = (registrationSeq += 1);
    const outcome = new Promise<NativeRegisterResult>((resolve) => {
      const timer = setTimeout(() => {
        // Only the current attempt may time out; a stale timer is inert.
        if (seq !== registrationSeq) return;
        // Diagnostics first, then settle. Fire-and-forget so the timeout is
        // never itself delayed by the probe.
        void gatherDiagnostics(receive).then((diagnostics) => {
          console.error(
            `[push/native] ${DIAGNOSTIC_CODE.noToken}: no APNs token within ${REGISTRATION_TIMEOUT_MS}ms`,
            diagnostics,
          );
          if (diagnostics.isNativePlatform !== true) {
            // The branch that decides everything. Not native means the control
            // should never have been offered, and the fix is a platform guard —
            // not Apple-side provisioning.
            console.error(
              `[push/native] ${DIAGNOSTIC_CODE.noToken}: NOT running natively (platform=${diagnostics.platform}). ` +
                "Push cannot work here and this control should not have been offered.",
            );
          } else if (!diagnostics.pluginResolved) {
            console.error(
              `[push/native] ${DIAGNOSTIC_CODE.noToken}: native, but the push plugin did not resolve.`,
            );
          } else {
            console.error(
              `[push/native] ${DIAGNOSTIC_CODE.noToken}: native, plugin present, permission ${diagnostics.permission}. ` +
                "Remaining candidate is Apple-side provisioning on the App ID — not fixable from this repo.",
            );
          }
        });
        settleRegistration({ status: "no-token" });
      }, REGISTRATION_TIMEOUT_MS);
      pending = {
        seq,
        settle: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      };
    });

    // Kicks off the exchange; the listeners above resolve `outcome`.
    await PushNotifications.register();
    return await outcome;
  } catch (err) {
    console.error("[push/native] registerNativePush failed", err);
    settleRegistration({ status: "error" });
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
