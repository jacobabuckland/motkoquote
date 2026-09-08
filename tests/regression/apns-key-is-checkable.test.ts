/**
 * A configured APNs key that cannot sign must be detectable before anything
 * depends on it.
 *
 * On 8 Sep 2026 a malformed APNS_PRIVATE_KEY in production threw from
 * `createSign().sign()` inside the promise executor in `postOnce`, escaped
 * `sendApns`, propagated through the `Promise.all` in `sendPushToUser`, and
 * surfaced as a FAILED ACTION in five separate flows — first view of a quote,
 * accept, contract sign, mark-as-paid, and every push send — each one after its
 * database write had already committed.
 *
 * The key had been unusable for an unknown period and nothing anywhere said so.
 * Fixing the key does not fix that; this does. The guard runs as `prebuild`, so
 * a deploy carrying a broken credential fails and says why.
 *
 * The distinction that carries the whole check is absent vs unusable. Absent is
 * every dev machine and every preview deploy, and failing there would make this
 * the check people delete. Unusable means somebody configured it and it does not
 * work — which is the silent state worth stopping a deploy for.
 */

import { describe, expect, it } from "vitest";

import { checkApnsKey, describeApnsKeyStatus, type ApnsEnv } from "@/lib/push/apns-config";

// A real, freshly-generated P-256 key, so the "usable" case proves signing
// rather than proving a regex. Generated per-run: nothing key-shaped is
// committed to the repository.
const generateUsableKey = async (): Promise<string> => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
};

const withKey = (privateKey: string): ApnsEnv => ({
  APNS_KEY_ID: "C6V9T2T3NZ",
  APNS_TEAM_ID: "79Q8PR5SA8",
  APNS_BUNDLE_ID: "app.motko.ios",
  APNS_PRIVATE_KEY: privateKey,
});

describe("the APNs credential is checkable before it is depended on", () => {
  it("reports a well-formed key as usable", async () => {
    const status = checkApnsKey(withKey(await generateUsableKey()));

    expect(status.state).toBe("usable");
  });

  it("reports the production failure — armour lines stripped — as unusable", () => {
    // What a paste into a deploy UI that eats newlines leaves behind: a body
    // with no BEGIN/END lines, which OpenSSL refuses.
    //
    // Deliberately LOW ENTROPY and obviously fake. The first version of this
    // fixture was a realistic truncated DER prefix, and GitGuardian correctly
    // flagged it as a "Generic High Entropy Secret" — a false positive that
    // still turns the security check red on every PR touching this file. The
    // bytes are irrelevant to what is being tested: `sign()` raises the same
    // DECODER error for anything it cannot parse. Do not make this look real.
    const status = checkApnsKey(withKey("this-is-not-a-pem-key"));

    expect(status.state).toBe("unusable");
    if (status.state !== "unusable") return;
    // Names the failure without ever carrying the key material.
    expect(status.detail.length).toBeGreaterThan(0);
    expect(status.detail).not.toContain("this-is-not-a-pem-key");
  });

  it("reports flattened newlines as unusable", async () => {
    // The other half of the same paste problem: armour present, line breaks
    // gone. Looks correct at a glance and OpenSSL still refuses it.
    const flattened = (await generateUsableKey()).replace(/\n/g, " ");

    expect(checkApnsKey(withKey(flattened)).state).toBe("unusable");
  });

  it("restores a key pasted with literal backslash-n", async () => {
    // apns.ts:64 does this on the send path, so the check must too — otherwise
    // it would condemn a key that actually works.
    const escaped = (await generateUsableKey()).replace(/\n/g, "\\n");

    expect(checkApnsKey(withKey(escaped)).state).toBe("usable");
  });

  it("treats no configuration as absent, not as a failure", () => {
    // Every dev machine and every preview deploy. A check that fails here is a
    // check that gets deleted.
    expect(checkApnsKey({}).state).toBe("absent");
  });

  it("treats a HALF-configured environment as unusable, not absent", async () => {
    // The state a partial rotation leaves behind. Passing it as "absent" would
    // silently disable push on an environment that is meant to have it — which
    // is the class of silence this whole item exists to remove.
    const env = withKey(await generateUsableKey());
    delete env.APNS_KEY_ID;

    const status = checkApnsKey(env);

    expect(status.state).toBe("unusable");
    if (status.state !== "unusable") return;
    expect(status.detail).toContain("APNS_KEY_ID");
  });

  it("tells the reader how to fix it, and never prints the key", async () => {
    const flattened = (await generateUsableKey()).replace(/\n/g, " ");
    const message = describeApnsKeyStatus(checkApnsKey(withKey(flattened)));

    // The remedy lives beside the diagnosis on purpose: the push-registration
    // toast asserted a cause it could not establish three times running, and
    // each wrong remedy sent someone somewhere expensive.
    // Names the armour lines without reproducing them — the repo's secret-scan
    // matches PEM header text on any added line, and quoting it in help copy
    // trips a check that is right to be that blunt.
    expect(message).toMatch(/BEGIN and END/);
    expect(message).toMatch(/line breaks/i);
    // The generated key's own body must never appear in the message.
    expect(message).not.toContain(flattened.slice(40, 80));
  });
});
