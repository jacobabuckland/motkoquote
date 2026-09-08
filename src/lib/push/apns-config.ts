// Can the configured APNs credential actually sign?
//
// On 8 Sep 2026 a malformed APNS_PRIVATE_KEY in production made
// `createSign().sign()` throw from inside the promise executor in `postOnce`,
// which escaped `sendApns` (documented "never throws"), propagated through the
// `Promise.all` fan-out in `sendPushToUser`, and came out of FIVE different
// server flows as a failed action: the customer's first view of a quote, quote
// accept, contract sign, mark-as-paid, and every push send. Each of those had
// already committed its database write, so the customer was told the action
// failed when it had succeeded.
//
// The key had been unusable for an unknown period and nothing said so. That is
// the gap this closes: the credential is now checkable BEFORE anything depends
// on it, both by hand after a rotation and automatically at build time.
//
// Deliberately NOT in apns.ts. That file computes the same thing on the send
// path, and a check that lives beside the thing it checks tends to be edited
// with it; keeping the validator separate also keeps this out of the way of the
// in-flight refactor on that file (#678).
//
// This validates the CREDENTIAL, not connectivity. A key that signs here can
// still be rejected by Apple as the wrong key for the team or topic — that is
// what `scripts/ops/check-apns-key.ts` is for, which drives the real send path.

import { createSign } from "node:crypto";

export type ApnsKeyStatus =
  /** No APNs configuration at all. Legitimate in dev and preview. */
  | { state: "absent"; missing: string[] }
  /** Configured, and the key signs. */
  | { state: "usable"; keyId: string; teamId: string; bundleId: string }
  /**
   * Configured but the key cannot sign — the production failure. `detail`
   * carries the crypto error's message, never the key itself.
   */
  | { state: "unusable"; keyId: string; teamId: string; detail: string };

const REQUIRED = [
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_PRIVATE_KEY",
  "APNS_BUNDLE_ID",
] as const;

/**
 * Reads the APNs env exactly as `getConfig()` in apns.ts does — including the
 * literal-`\n` restoration, which is the transformation that makes a pasted key
 * work or not — and attempts one ES256 signature.
 *
 * Signing is the whole test. A PEM can look right and still be unparseable by
 * OpenSSL (armour lines stripped, newlines flattened by a deploy UI, a PKCS#1
 * key where PKCS#8 is wanted), and none of that is visible from the string's
 * shape. Only `sign()` knows.
 */
// Read as a plain bag of optional strings rather than NodeJS.ProcessEnv: this
// only ever reads four named keys, and the wider type would force every caller
// — including a test constructing a two-key fixture — to satisfy the whole
// declared environment.
export type ApnsEnv = Record<string, string | undefined>;

export const checkApnsKey = (env: ApnsEnv = process.env): ApnsKeyStatus => {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length === REQUIRED.length) return { state: "absent", missing };
  // A PARTIAL configuration is not "absent" — somebody meant to configure this
  // and left it half done, which is exactly the silent state worth failing on.
  if (missing.length > 0) {
    return {
      state: "unusable",
      keyId: env.APNS_KEY_ID ?? "(unset)",
      teamId: env.APNS_TEAM_ID ?? "(unset)",
      detail: `incomplete configuration — missing ${missing.join(", ")}`,
    };
  }

  const keyId = env.APNS_KEY_ID!;
  const teamId = env.APNS_TEAM_ID!;
  const bundleId = env.APNS_BUNDLE_ID!;
  // Same restoration as apns.ts:64. A key pasted with real newlines is
  // unchanged by this; one pasted with literal backslash-n is repaired.
  const privateKey = env.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n");

  try {
    const signer = createSign("SHA256");
    signer.update("motko.apns.keycheck");
    // `ieee-p1363` matches the send path. A key that signs only in DER here
    // would be a check that passes while delivery fails.
    signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
    return { state: "usable", keyId, teamId, bundleId };
  } catch (err) {
    return {
      state: "unusable",
      keyId,
      teamId,
      // The message only. An OpenSSL error names the failure mode
      // ("DECODER routines::unsupported"), never the key material.
      detail: err instanceof Error ? err.message : String(err),
    };
  }
};

/**
 * What a human should do about each state, in the words of the fix.
 *
 * Kept next to the check so the remedy cannot drift from the diagnosis — the
 * mistake the push-registration toast made three times over (see native.ts).
 */
export const describeApnsKeyStatus = (status: ApnsKeyStatus): string => {
  switch (status.state) {
    case "absent":
      return "APNs is not configured. Push to iOS devices is off; nothing else is affected.";
    case "usable":
      return `APNs key ${status.keyId} (team ${status.teamId}, topic ${status.bundleId}) signs correctly.`;
    case "unusable":
      return (
        `APNs key ${status.keyId} (team ${status.teamId}) is configured but CANNOT SIGN: ${status.detail}. ` +
        "APNS_PRIVATE_KEY must be the whole .p8 file including the " +
        "'-----BEGIN PRIVATE KEY-----' and '-----END PRIVATE KEY-----' lines, with its line " +
        "breaks intact (literal \\n is also accepted). A deploy UI that strips newlines is the " +
        "usual cause."
      );
  }
};
