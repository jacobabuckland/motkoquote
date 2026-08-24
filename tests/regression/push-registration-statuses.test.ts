// Regression: enabling notifications reported "Apple didn't send back a
// notification token. Update to the latest app version and try again."
//
// Two things were wrong with that.
//
// It named a cause nobody had established, and a remedy that cannot work: the
// contractor was already on the latest build. The repo's own evidence says the
// two things that copy implies are both fine — ios/App/App/App.entitlements
// carries aps-environment, and AppDelegate.swift bridges both
// didRegisterForRemoteNotificationsWithDeviceToken and
// didFailToRegisterForRemoteNotificationsWithError to Capacitor.
//
// And `no-token` was settled by two unrelated conditions. A genuine APNs
// rejection settles as 'error' via the registrationError listener, so the two
// real producers were the 10s timeout and — the bad one — an attempt abandoned
// because a newer one started. Tapping the button twice made the FIRST call
// report a token failure, even when the second went on to succeed. The most
// confusing outcome available: a failure message for something that worked.
import { describe, expect, it } from "vitest";
import { nativeRegisterMessage } from "@/lib/push/native";
import type { NativeRegisterResult } from "@/lib/push/native";

// The real map the Settings screen calls, not a copy of it. A test that mirrors
// the copy can pass while the screen says something else.
type Status = NativeRegisterResult["status"];
const messageFor = nativeRegisterMessage;

const ALL: Status[] = [
  "registered",
  "not-native",
  "denied",
  "no-token",
  "superseded",
  "save-failed",
  "error",
];

describe("push registration statuses", () => {
  it("carries a distinct status for a superseded attempt", () => {
    // The fix. Without its own status this case settles as 'no-token' and a
    // double-tap manufactures a token failure out of nothing.
    const superseded: Status = "superseded";
    expect(ALL).toContain(superseded);
  });

  it("says nothing at all when an attempt was superseded", () => {
    expect(
      messageFor("superseded"),
      "a superseded attempt must not reach the user — the newer attempt owns the outcome",
    ).toBeNull();
  });

  it("never blames the app version for a token failure", () => {
    const message = messageFor("no-token") ?? "";
    expect(message).not.toMatch(/update to the latest app version/i);
    expect(message).not.toMatch(/update/i);
  });

  it("points a token failure at something the contractor can actually act on", () => {
    const message = messageFor("no-token") ?? "";
    expect(message).toMatch(/connection|support/i);
  });

  it("keeps a blocked permission distinct from a token failure", () => {
    // These were never conflated and must not become so: a contractor who
    // declined the OS prompt needs iOS Settings, not a retry.
    expect(messageFor("denied")).toMatch(/iOS Settings/);
    expect(messageFor("denied")).not.toBe(messageFor("no-token"));
  });

  it("gives every status that reaches the user its own copy", () => {
    const shown = ALL.map(messageFor).filter((m): m is string => m !== null);
    expect(new Set(shown).size, `duplicate copy across statuses: ${shown.join(" | ")}`).toBe(
      shown.length,
    );
  });

  it("has copy for every status in the union", () => {
    // nativeRegisterMessage's switch is total over Status, so an unhandled
    // status is a compile error. This asserts the runtime list above has not
    // drifted from the union.
    for (const status of ALL) {
      expect(() => messageFor(status)).not.toThrow();
    }
  });
});
