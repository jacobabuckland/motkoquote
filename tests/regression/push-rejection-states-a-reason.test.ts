import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTestNotification } from "@/lib/push/client";
import {
  REJECTION_CODE,
  causeOfRejection,
  testSendFailureMessage,
} from "@/lib/push/send-failure-copy";

/**
 * A rejected test notification must say why, to the person holding the phone.
 *
 * Settings said "All devices rejected the notification. Check the server logs."
 * — to a contractor, about a server they have no access to, while the reason sat
 * in the response the button had just received. `sendPushToUser` has collected
 * it all along; the type comment on PushFanoutSummary says `failures` exists
 * "for diagnosability".
 *
 * It was dropped at two layers, and this pins both: TestNotificationResult in
 * push/client.ts did not carry `failures`, so it never reached the component,
 * and the component would not have rendered it if it had.
 *
 * The discipline is NO_TOKEN_LOG's in native.ts: name a cause only where the
 * reason establishes one, and where it does not, say what is true and hand over
 * a code rather than dressing a guess as a diagnosis.
 */
describe("a rejected push states a reason", () => {
  it("never tells the contractor to read a server log", () => {
    // The whole defect in one assertion. Every branch, not just the common one.
    const inputs = [
      [],
      [{ platform: "apns", reason: "BadDeviceToken" }],
      [{ platform: "apns", reason: "InvalidProviderKey" }],
      [{ platform: "apns", reason: "SomethingAppleAddedLastTuesday" }],
      [
        { platform: "apns", reason: "BadDeviceToken" },
        { platform: "webpush", reason: "InvalidProviderKey" },
      ],
    ];
    for (const failures of inputs) {
      expect(testSendFailureMessage(failures)).not.toMatch(/server log/i);
    }
  });

  it("always hands over a code to quote", () => {
    for (const reason of ["BadDeviceToken", "InvalidProviderKey", "BadTopic", "wat"]) {
      expect(testSendFailureMessage([{ platform: "apns", reason }])).toMatch(
        /PUSH-RJ/,
      );
    }
  });

  describe("classifies only what the reason actually establishes", () => {
    it("a token Apple refused on BOTH gateways is a token fault", () => {
      // sendApns retries the other gateway on precisely BadDeviceToken and only
      // reports failure once both refuse, so by the time it reaches a summary
      // this is a fact about the token rather than about routing.
      expect(causeOfRejection("BadDeviceToken")).toBe("token");
      expect(causeOfRejection("Unregistered")).toBe("token");
    });

    it("a provider-key fault is ours, and says so", () => {
      expect(causeOfRejection("InvalidProviderKey")).toBe("key");
      const message = testSendFailureMessage([
        { platform: "apns", reason: "InvalidProviderKey" },
      ]);
      // The contractor must not be sent to reinstall against a server fault.
      expect(message).toMatch(/nothing you can do/i);
      expect(message).not.toMatch(/turn notifications off/i);
    });

    it("a topic fault is ours too", () => {
      expect(causeOfRejection("DeviceTokenNotForTopic")).toBe("topic");
      expect(causeOfRejection("BadTopic")).toBe("topic");
    });

    it("refuses to diagnose a reason it does not recognise", () => {
      expect(causeOfRejection("SomethingAppleAddedLastTuesday")).toBe("unknown");
      const message = testSendFailureMessage([
        { platform: "apns", reason: "SomethingAppleAddedLastTuesday" },
      ]);
      expect(message).toMatch(/without saying why/i);
      // No remedy invented for a cause we have not established.
      expect(message).not.toMatch(/turn notifications off/i);
      expect(message).not.toMatch(/nothing you can do/i);
    });
  });

  it("only tells them to re-register when that is actually the fix", () => {
    const message = testSendFailureMessage([
      { platform: "apns", reason: "BadDeviceToken" },
    ]);
    expect(message).toMatch(/turn notifications off and on/i);
    expect(message).toContain(REJECTION_CODE.token);
  });

  it("does not pick a winner when devices failed for different reasons", () => {
    // Naming one cause while another is live sends them after the wrong thing.
    const message = testSendFailureMessage([
      { platform: "apns", reason: "BadDeviceToken" },
      { platform: "webpush", reason: "InvalidProviderKey" },
    ]);
    expect(message).toMatch(/different reasons/i);
    expect(message).toContain(REJECTION_CODE.token);
    expect(message).toContain(REJECTION_CODE.key);
    expect(message).not.toMatch(/turn notifications off and on/i);
  });

  it("says what is true when nothing sent and nothing reported why", () => {
    const message = testSendFailureMessage([]);
    expect(message).toMatch(/no device reported why/i);
    expect(message).toContain(REJECTION_CODE.unknown);
  });
});

/**
 * The reason has to SURVIVE the client wrapper, or the copy above is unreachable.
 *
 * This is the layer the original defect actually died at:
 * `TestNotificationResult` did not declare `failures`, so sendTestNotification
 * built its return value without it and /api/push/test's reason was discarded
 * before any component could read it.
 *
 * Worth its own test because dropping it again fails NOTHING above — every
 * assertion in this file still passes against an empty list, and Settings would
 * quietly report "no device reported why" for every real rejection. A silent
 * downgrade to a less useful message is exactly the shape that got us here.
 */
describe("the reason survives the client wrapper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respondWith = (body: unknown) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url?: unknown, _init?: unknown) => ({
        ok: true,
        json: async () => body,
      })),
    );
  };

  it("carries every failure through from the API response", async () => {
    respondWith({
      ok: false,
      devices: 2,
      sent: 0,
      failed: 2,
      failures: [
        { platform: "apns", reason: "BadDeviceToken" },
        { platform: "webpush", reason: "InvalidProviderKey" },
      ],
    });

    const result = await sendTestNotification();

    expect(result?.failures).toEqual([
      { platform: "apns", reason: "BadDeviceToken" },
      { platform: "webpush", reason: "InvalidProviderKey" },
    ]);
    // And end to end: what Settings would actually show.
    expect(testSendFailureMessage(result?.failures ?? [])).toMatch(
      /different reasons/i,
    );
  });

  it("defaults to an empty list rather than throwing on a malformed response", async () => {
    respondWith({ devices: 1, sent: 0, failed: 1 });
    const result = await sendTestNotification();
    expect(result?.failures).toEqual([]);
  });
});
