// Post-rotation verification: does the APNs credential actually work?
//
// RUNNABLE: npx tsx scripts/ops/check-apns-key.ts
//
// Run this straight after pasting APNS_PRIVATE_KEY, with the production
// environment loaded. It is the observable success criterion for that change —
// the alternative was "run the whole journey and see if symptoms clear", which
// is slow, needs a customer-side device, and confuses a key problem with the
// four other things that journey touches.
//
// TWO LEVELS, and the second is the one that matters:
//
//   1. Can the key sign at all? (`checkApnsKey`, no network.)
//   2. Does APPLE accept it? This drives the REAL send path — `sendApns` with a
//      deliberately invalid device token — because a key can be perfectly
//      well-formed and still be the wrong key for the team or the topic, and
//      only Apple can say so.
//
// Reading the result of (2):
//
//   BadDeviceToken   -> SUCCESS. Apple authenticated the provider token and
//                       then rejected the fake device token, which is exactly
//                       what a fake device token deserves. The credential works.
//   InvalidProviderKey -> the key still cannot sign locally.
//   403 / InvalidProviderToken / TopicDisallowed -> the key signs but Apple
//                       refuses it: wrong key id, wrong team, or a bundle id
//                       that is not this key's topic.
//
// Sends nothing to any real device: the token below is 64 hex zeroes, which is
// well-formed enough to be routed and cannot belong to a handset.

import { checkApnsKey, describeApnsKeyStatus } from "../../src/lib/push/apns-config";
import { sendApns } from "../../src/lib/push/apns";

const FAKE_DEVICE_TOKEN = "0".repeat(64);

const main = async (): Promise<void> => {
  const status = checkApnsKey();
  console.log(`\n1. Credential parses: ${describeApnsKeyStatus(status)}`);

  if (status.state === "absent") {
    console.log("\nNothing further to check — APNs is not configured here.");
    console.log("Load the production environment if you meant to check that.\n");
    process.exit(0);
  }

  if (status.state === "unusable") {
    console.error("\n✗ Stop here. Fix the key before checking Apple.\n");
    process.exit(1);
  }

  console.log("\n2. Asking Apple, with a deliberately invalid device token…");
  const result = await sendApns(
    FAKE_DEVICE_TOKEN,
    {
      event: "test",
      title: "motko credential check",
      body: "Not delivered to any device.",
      url: "/dashboard",
    },
    "/credential-check",
  );

  const reason = result.reason ?? "(none)";

  // The success case is a REJECTION, which is why this cannot be a truthiness
  // check on `ok`. Apple rejecting a fake token proves it read and trusted the
  // provider token first.
  if (reason === "BadDeviceToken") {
    console.log(
      `\n✓ PASS. Apple authenticated the provider token and rejected the fake device ` +
        `token (${reason}, status ${result.status ?? "?"}).\n` +
        `  The credential works. Push will deliver to real devices.\n`,
    );
    process.exit(0);
  }

  if (reason === "InvalidProviderKey") {
    console.error(
      `\n✗ FAIL. The key could not sign on the send path.\n` +
        `  ${describeApnsKeyStatus(status)}\n`,
    );
    process.exit(1);
  }

  console.error(
    `\n✗ FAIL. Apple did not accept the credential: reason=${reason} ` +
      `status=${result.status ?? "?"} gateway=${result.env ?? "none reached"}.\n` +
      `  The key signs locally, so this is a mismatch rather than a malformed key:\n` +
      `  check APNS_KEY_ID matches the .p8, APNS_TEAM_ID is the right team, and\n` +
      `  APNS_BUNDLE_ID is a topic this key is enabled for.\n`,
  );
  process.exit(1);
};

main().catch((error: unknown) => {
  console.error("\n✗ The check itself failed:", error);
  process.exit(1);
});
