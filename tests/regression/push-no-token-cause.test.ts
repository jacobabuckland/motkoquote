import { describe, expect, it } from "vitest";
import {
  DIAGNOSTIC_CODE,
  NO_TOKEN_CODE,
  messageForResult,
  nativeRegisterMessage,
} from "@/lib/push/native";
import type { NativeRegisterResult, NoTokenCause } from "@/lib/push/native";

// A downloaded build reported PUSH-NT on a real phone. The timeout had ALREADY
// computed which of the three causes it was — and written it to console.error,
// which needs a Mac and Console.app to read. So the one fact that identifies
// who owns the fault never reached anyone holding the device, and the same
// toast was shown for three unrelated problems.
//
// The rule this broke is in AGENTS.md: a signal that must change behaviour
// cannot terminate in telemetry.

const CAUSES: NoTokenCause[] = ["not-native", "plugin-missing", "provisioning"];

const noToken = (cause: NoTokenCause): NativeRegisterResult => ({
  status: "no-token",
  cause,
});

describe("the no-token toast names its cause", () => {
  it("says something different for each of the three", () => {
    const shown = CAUSES.map((c) => messageForResult(noToken(c)));
    expect(new Set(shown).size, `not distinct: ${shown.join(" | ")}`).toBe(3);
  });

  it("carries a code per cause, all still stemming from PUSH-NT", () => {
    for (const cause of CAUSES) {
      const message = messageForResult(noToken(cause)) ?? "";
      expect(message).toContain(NO_TOKEN_CODE[cause]);
      // Anything that matched the old single code still matches these, so a
      // contractor reading one down the phone is obviously the same family.
      expect(NO_TOKEN_CODE[cause]).toContain(DIAGNOSTIC_CODE.noToken);
    }
    expect(new Set(Object.values(NO_TOKEN_CODE)).size).toBe(3);
  });

  it("reports the state that actually occurred, per cause", () => {
    // Both withdrawn versions of this copy asserted a cause and were wrong.
    // Naming the cause must not come at the price of dropping the observation
    // — nor of making one up: on a non-native runtime Apple was never asked,
    // so "Apple didn't return a token" is itself an event that did not happen.
    for (const cause of ["plugin-missing", "provisioning"] as const) {
      expect(messageForResult(noToken(cause)) ?? "").toMatch(
        /didn't return a token/i,
      );
    }
    expect(messageForResult(noToken("not-native")) ?? "").not.toMatch(
      /didn't return a token/i,
    );
  });

  it("never revives either of the two causes that were disproved", () => {
    for (const cause of CAUSES) {
      const message = messageForResult(noToken(cause)) ?? "";
      expect(message, "the app was already on the latest build").not.toMatch(
        /update/i,
      );
      expect(
        message,
        "the device had full signal and was loading from the same server",
      ).not.toMatch(/connection/i);
    }
  });

  it("blames Apple's setup ONLY when the app is genuinely native", () => {
    // The ordering that matters. A home-screen web app looks native to a user,
    // and telling someone to re-issue a provisioning profile for a browser
    // sends them days in the wrong direction — which is how the original
    // PUSH-NT was handled as a connectivity problem.
    const provisioning = messageForResult(noToken("provisioning")) ?? "";
    expect(provisioning).toMatch(/Apple/i);

    const notNative = messageForResult(noToken("not-native")) ?? "";
    expect(notNative).not.toMatch(/Apple/i);
    expect(notNative).toMatch(/isn't the iOS app/i);
  });

  it("falls back to the state-only wording when the cause is unknown", () => {
    // Diagnostics that could not be gathered must not invent a reason — that
    // discipline is the whole history of this string.
    const bare = nativeRegisterMessage("no-token") ?? "";
    expect(bare).toContain(DIAGNOSTIC_CODE.noToken);
    expect(bare).toMatch(/didn't return a token/i);
    for (const cause of CAUSES) {
      expect(bare).not.toContain(NO_TOKEN_CODE[cause]);
    }
  });

  it("leaves every other status untouched", () => {
    // messageForResult must be a pure widening of nativeRegisterMessage.
    for (const status of ["registered", "denied", "save-failed", "error"] as const) {
      expect(messageForResult({ status })).toBe(nativeRegisterMessage(status));
    }
    expect(messageForResult({ status: "superseded" })).toBeNull();
  });
});
