// Deploy-time guard: a configured APNs key that cannot sign fails the build.
//
// RUNNABLE: npx tsx scripts/ci/check-apns-config.ts
//
// Runs as `prebuild`, so it gates every Vercel deploy. The rule is narrow on
// purpose:
//
//   absent   -> pass. Dev and preview environments legitimately have no APNs
//               config, and failing there would make this the check everyone
//               disables.
//   usable   -> pass.
//   unusable -> FAIL the build.
//
// "Unusable" means somebody configured the key and it does not work. That
// deploy was already broken for push; failing here only moves the discovery
// from "a contractor reports no notifications, and two days of Apple-side
// archaeology follows" to "the deploy went red and said why". It cannot break a
// deploy that would otherwise have been fine.
//
// This deliberately does NOT live in src/checks/. That lane runs under
// vitest.live.config.ts, which loads tests/setup.ts, which mocks
// @/lib/supabase/admin — so the live checks have been failing since 30 Aug and
// a guard placed there would be a guard nobody reads. Decision 8 Sep 2026
// (Jacob): a P0 does not wait on repairing that lane; the lane is its own
// ticket. See areas/motko.md.

import { checkApnsKey, describeApnsKeyStatus } from "../../src/lib/push/apns-config";

const status = checkApnsKey();
const description = describeApnsKeyStatus(status);

if (status.state === "unusable") {
  console.error(`\n✗ APNs config check failed.\n\n  ${description}\n`);
  process.exit(1);
}

console.log(`✓ APNs config: ${description}`);
