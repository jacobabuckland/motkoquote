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

/**
 * WHY no token came back — the one thing that decides what to do about it.
 *
 * The three are genuinely different problems with different owners, and until
 * now they were indistinguishable to anyone holding the phone: the timeout
 * computed exactly this and then wrote it to `console.error`, which needs a Mac
 * and Console.app to read. A downloaded build on a contractor's phone has
 * neither, so the one fact that identifies the fault never reached anybody who
 * could act on it. That is the shape AGENTS.md warns about — a signal that must
 * change behaviour cannot terminate in telemetry.
 *
 * `provisioning` is an inference, but a well-founded one rather than a guess:
 * it is only reached when the runtime IS native, the plugin DID resolve, and
 * the OS permission was GRANTED — no-token is unreachable otherwise, because a
 * refusal returns `denied` long before the timeout. Notification permission is
 * UNUserNotificationCenter and is independent of APNs; what
 * registerForRemoteNotifications needs on top is the `aps-environment`
 * entitlement, and iOS fails that silently — no callback, no error — when the
 * installed build's provisioning profile does not carry it.
 */
export type NoTokenCause = "not-native" | "plugin-missing" | "provisioning";

export type NativeRegisterResult =
  | { status: "registered" }
  | { status: "not-native" }
  | { status: "denied" }
  // The token round trip did not finish within REGISTRATION_TIMEOUT_MS. A
  // genuine APNs rejection settles as 'error' via the registrationError
  // listener, so this is specifically "nothing came back in time" — a dead
  // network, or the native side never answering at all (the AppDelegate
  // remote-notification bridge missing, or no push entitlement on the build).
  | { status: "no-token"; cause: NoTokenCause }
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
 * PUSH-NT, narrowed to the cause. Each keeps `PUSH-NT` as its stem so anything
 * matching the old code still matches these, and so a contractor reading one
 * down the phone is obviously reporting the same family of fault.
 */
export const NO_TOKEN_CODE: Record<NoTokenCause, string> = {
  "not-native": `${DIAGNOSTIC_CODE.noToken}-WEB`,
  "plugin-missing": `${DIAGNOSTIC_CODE.noToken}-PLUGIN`,
  provisioning: `${DIAGNOSTIC_CODE.noToken}-PROV`,
};

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
  cause?: NoTokenCause,
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
    case "no-token": {
      const state = `Couldn't set up notifications on this device. Apple didn't return a token within ${REGISTRATION_TIMEOUT_MS / 1000} seconds`;
      // No cause: an older caller, or diagnostics that could not be gathered.
      // Falls back to the state-only wording rather than inventing a reason —
      // which is the discipline the two withdrawn versions of this string
      // failed. Naming nothing beats naming the wrong thing.
      if (!cause) {
        return `${state}. Quote code ${DIAGNOSTIC_CODE.noToken} to support.`;
      }
      // not-native does NOT get the shared sentence. Apple was never asked —
      // there is no native runtime to ask from — so reporting that Apple
      // didn't answer would be the same class of error as the two withdrawn
      // versions of this string: an observation that did not happen.
      if (cause === "not-native") {
        return `Couldn't set up notifications on this device — this isn't the iOS app, so push can't work here. Quote code ${NO_TOKEN_CODE[cause]} to support.`;
      }
      const because =
        cause === "plugin-missing"
          ? "the push component didn't load in this build"
          : "this build isn't set up for push at Apple's end";
      return `${state} — ${because}. Quote code ${NO_TOKEN_CODE[cause]} to support.`;
    }
    case "save-failed":
      return `Your device registered, but we couldn't save it. Quote code ${DIAGNOSTIC_CODE.saveFailed} to support.`;
    case "error":
      return `Couldn't enable notifications. Quote code ${DIAGNOSTIC_CODE.error} to support.`;
  }
};

/**
 * The OS notification permission as it stands, WITHOUT asking for it.
 *
 * The distinction matters more than it looks: iOS shows its permission alert
 * exactly once per install. Anything that wants to decide whether to offer
 * notifications must be able to read the current state without spending that
 * one alert, which `registerNativePush` cannot do — asking is its job.
 *
 * "prompt" collapses Capacitor's two pre-decision states, because a caller
 * deciding whether to offer the choice has no use for the difference. Anything
 * that is not a live iOS runtime — the web, a failed plugin import — is
 * "unavailable" rather than "denied": the two lead to different UI, and calling
 * a browser "denied" would be a claim about a decision nobody made.
 */
export type NativePushPermission = "granted" | "denied" | "prompt" | "unavailable";

export const nativePushPermission = async (): Promise<NativePushPermission> => {
  if (!isNativeApp()) return "unavailable";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "granted") return "granted";
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      return "prompt";
    }
    return "denied";
  } catch (err) {
    console.error("[push/native] checkPermissions failed", err);
    return "unavailable";
  }
};

/**
 * The message for a whole result — what every UI caller actually wants.
 *
 * Exists so the narrowing from result to (status, cause) is written once. Two
 * screens show this copy and neither should have to know that `cause` rides on
 * exactly one variant of the union.
 */
export const messageForResult = (result: NativeRegisterResult): string | null =>
  nativeRegisterMessage(
    result.status,
    result.status === "no-token" ? result.cause : undefined,
  );

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

/**
 * The one branch that decides who owns this failure.
 *
 * Order matters and is not arbitrary. "Not native" is checked first because it
 * invalidates everything after it — a home-screen web app looks native to a
 * user, and asking a browser why Apple sent no token is a category error. Only
 * once the runtime is native and the plugin is really there does Apple-side
 * provisioning become the remaining explanation.
 */
const classifyNoToken = (d: RegistrationDiagnostics): NoTokenCause => {
  if (d.isNativePlatform !== true) return "not-native";
  if (!d.pluginResolved) return "plugin-missing";
  return "provisioning";
};

/** What each cause means for whoever reads the console, spelled out once. */
const NO_TOKEN_LOG: Record<NoTokenCause, string> = {
  "not-native":
    "NOT running natively. Push cannot work here and this control should not have been offered — the fix is a platform guard, not Apple-side provisioning.",
  "plugin-missing":
    "native, but the push plugin did not resolve. The build is missing the Capacitor plugin, not an Apple entitlement.",
  provisioning:
    "native, plugin present, permission granted, and still no token. registerForRemoteNotifications fails silently without the aps-environment entitlement, so the installed build's provisioning profile is the remaining candidate — re-issue it with Push Notifications enabled on the App ID and re-archive. Not fixable from this repo.",
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
        // The diagnostics are now AWAITED rather than fire-and-forget, because
        // the cause they compute travels back to the caller and onto the
        // screen. Previously they were logged after the promise had already
        // settled, which is why the one fact identifying the fault could only
        // ever be read off a Mac. The probe is two dynamic imports of modules
        // already loaded, so this costs microseconds on a 10-second timeout.
        void (async () => {
          const diagnostics = await gatherDiagnostics(receive);
          const cause = classifyNoToken(diagnostics);
          console.error(
            `[push/native] ${NO_TOKEN_CODE[cause]}: no APNs token within ${REGISTRATION_TIMEOUT_MS}ms`,
            diagnostics,
          );
          console.error(
            `[push/native] ${NO_TOKEN_CODE[cause]}: ${NO_TOKEN_LOG[cause]}`,
          );
          // Re-checked AFTER the await: a newer attempt may have started while
          // the probe ran, and settling then would hand this attempt's failure
          // to a registration that is still in flight — the exact confusion the
          // 'superseded' status exists to prevent.
          if (seq !== registrationSeq) return;
          settleRegistration({ status: "no-token", cause });
        })();
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
