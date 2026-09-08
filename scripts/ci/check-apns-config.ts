// Deploy-time visibility for the APNs credential.
//
// RUNNABLE: npx tsx scripts/ci/check-apns-config.ts
//
// Runs as `prebuild`, so every deploy reports the state of the key.
//
// IT DOES NOT FAIL THE BUILD, and that is a correction rather than the original
// design. The first version exited 1 on a configured-but-unusable key, and the
// first Vercel deploy after it went red. Whichever of the two causes it was —
// the key really is unusable, or this script could not run there — the lesson
// is the same and it is about blast radius: a PUSH NOTIFICATION credential had
// been given the power to stop every deploy, including the deploy that would
// have fixed it. Nothing about push is worth that.
//
// So the guard is loud, not fatal. What actually reaches a human is the daily
// notification-health report (see src/lib/notification-health.ts), which emails
// on a non-zero 24h failure count and heartbeats weekly — a delivered signal
// rather than a line in a build log nobody opens.
//
// This deliberately does NOT live in src/checks/. That lane runs under
// vitest.live.config.ts, which loads tests/setup.ts, which mocks
// @/lib/supabase/admin — so the live checks have been failing since 30 Aug and
// a guard placed there would be a guard nobody reads. Decision 8 Sep 2026
// (Jacob): a P0 does not wait on repairing that lane; the lane is its own
// ticket. See areas/motko.md.

import { checkApnsKey, describeApnsKeyStatus } from "../../src/lib/push/apns-config";

// Never throws out of here. A check that cannot run must not be the reason a
// deploy fails — that is the same mistake as the exit(1) this replaces, wearing
// a different hat.
try {
  const status = checkApnsKey();
  const description = describeApnsKeyStatus(status);

  if (status.state === "unusable") {
    // Loud enough to find in a build log, and phrased so the reader knows the
    // deploy is proceeding on purpose rather than the check having passed.
    console.error(
      `\n${"!".repeat(72)}\n` +
        `APNs PUSH IS BROKEN ON THIS DEPLOY — building anyway.\n\n  ${description}\n\n` +
        `  Verify with: npx tsx scripts/ops/check-apns-key.ts\n` +
        `${"!".repeat(72)}\n`,
    );
  } else {
    console.log(`✓ APNs config: ${description}`);
  }
} catch (error) {
  console.error("[check-apns-config] the check itself could not run:", error);
}
