import { DIAGNOSTIC_CODE } from "@/lib/push/native";

/**
 * Turning a rejected push into something the contractor can act on.
 *
 * The Settings test button said "All devices rejected the notification. Check
 * the server logs." — to a tradesperson, about a server they cannot read, while
 * the reason sat in the response the button had just received.
 *
 * It was dropped twice over: `TestNotificationResult` in push/client.ts did not
 * carry `failures` at all, so it never reached the component, and the component
 * would not have shown it if it had. `sendPushToUser` has always collected it —
 * the comment on `PushFanoutSummary` says `failures` exists "for
 * diagnosability".
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is guess. Following NO_TOKEN_LOG in
 * native.ts, a reason that does not establish a cause gets copy that says what
 * to check rather than a diagnosis dressed up as one. Only three of these
 * genuinely narrow it.
 */

/** PUSH-RJ, narrowed. `PUSH-RJ` is the stem so the family is obvious on a call. */
export const REJECTION_CODE = {
  /** The token is not valid for this app. Apple was asked on BOTH gateways. */
  token: `${DIAGNOSTIC_CODE.rejected}-TOKEN`,
  /** Our signing key or provider token. Nothing the contractor can do. */
  key: `${DIAGNOSTIC_CODE.rejected}-KEY`,
  /** Bundle id vs apns-topic. Server configuration, not the device. */
  topic: `${DIAGNOSTIC_CODE.rejected}-TOPIC`,
  /** Reached us, told us nothing useful. Not a diagnosis. */
  unknown: DIAGNOSTIC_CODE.rejected,
} as const;

export type RejectionCause = keyof typeof REJECTION_CODE;

/**
 * Apple's `reason` strings, plus the two this codebase synthesises.
 *
 * BadDeviceToken is in the `token` bucket and not the routing one on purpose:
 * sendApns retries the other gateway on precisely that reason and only reports
 * the failure once BOTH have refused (apns.ts — `if (result.reason !==
 * "BadDeviceToken") break;`). So by the time it reaches a summary it is a fact
 * about the token, not about which host we tried.
 */
const CAUSE_OF: Record<string, RejectionCause> = {
  BadDeviceToken: "token",
  Unregistered: "token",
  gone: "token",
  DeviceTokenNotForTopic: "topic",
  TopicDisallowed: "topic",
  BadTopic: "topic",
  InvalidProviderKey: "key",
  ExpiredProviderToken: "key",
  MissingProviderToken: "key",
  InvalidProviderToken: "key",
};

export const causeOfRejection = (reason: string): RejectionCause =>
  CAUSE_OF[reason] ?? "unknown";

/** What the contractor is told. One sentence, then the code to quote. */
const COPY: Record<RejectionCause, string> = {
  // Actionable, and the only bucket where re-registering is the fix: the
  // registration this device holds is no longer one Apple recognises, which is
  // what a reinstall or a restored backup leaves behind.
  token:
    "This device's notification registration has expired. Turn notifications off and on again to re-register it.",
  // Not the contractor's to fix, and saying so is the point — otherwise they
  // reinstall the app repeatedly against a server-side fault.
  key: "Notifications aren't set up correctly on our side. Nothing you can do — this one's ours.",
  topic:
    "This build isn't configured for notifications on our side. Nothing you can do — this one's ours.",
  // Deliberately NOT a diagnosis, for the same reason NO_TOKEN_LOG.provisioning
  // is not one: everything unrecognised lands here, and a bucket that catches
  // everything cannot narrow anything.
  unknown: "Apple rejected it without saying why.",
};

/**
 * The message for a test send where nothing was delivered.
 *
 * Takes the whole list because a contractor can have several devices failing
 * for different reasons, and a message naming one cause while another is live
 * would send them after the wrong thing. Mixed causes therefore report the
 * count rather than picking a winner, and always carry the codes.
 */
export const testSendFailureMessage = (
  failures: { platform: string; reason: string }[],
): string => {
  if (failures.length === 0) {
    // No devices rejected, yet nothing was sent — the caller should not have
    // reached this. Say what is true rather than inventing a cause.
    return `Nothing was sent, and no device reported why. Quote code ${REJECTION_CODE.unknown} to support.`;
  }

  const causes = [...new Set(failures.map((f) => causeOfRejection(f.reason)))];

  if (causes.length === 1) {
    const cause = causes[0]!;
    return `${COPY[cause]} Quote code ${REJECTION_CODE[cause]} to support.`;
  }

  const codes = causes.map((c) => REJECTION_CODE[c]).sort().join(", ");
  return `Your ${failures.length} devices were rejected for different reasons. Quote codes ${codes} to support.`;
};
