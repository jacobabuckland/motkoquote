/**
 * "Enable notifications" hung with no error, twice, on motko.app on 20 Sep.
 *
 * Click it, the label becomes "Enabling…", the button greys out, and it stays
 * that way — ten seconds the first time, eleven the second. No error, no
 * success, no timeout. The status line above still read "Not on for this
 * device", and there was no way to tell whether it had worked, retry, or find
 * out why.
 *
 * Two independent causes, and neither could produce a message:
 *
 * 1. `navigator.serviceWorker.ready` NEVER REJECTS. It resolves when a worker
 *    becomes active and otherwise waits for the life of the page, so a
 *    `/sw.js` that registers and never activates left the await pending with
 *    nothing thrown for the `catch` to see.
 *
 * 2. `Notification.requestPermission()` was awaited OUTSIDE the try/catch, so
 *    a browser that rejects the request rather than answering it threw past
 *    the `RegisterResult` union the caller switches on — and the caller's
 *    `setEnabling(false)` was a plain statement after an await, with no
 *    finally, so the control was never released.
 *
 * These bind the helper. The caller's guarantee — the control always comes
 * back — is a `finally` in `enableNotifications`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Nav = {
  serviceWorker: {
    register: () => Promise<unknown>;
    ready: Promise<unknown>;
  };
};

const install = (options: {
  permission: () => Promise<NotificationPermission>;
  ready: Promise<unknown>;
}) => {
  vi.stubGlobal("window", { PushManager: function () {}, Notification: function () {} });
  vi.stubGlobal("Notification", { requestPermission: options.permission, permission: "default" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: async () => ({
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => {
            throw new Error("not reached");
          },
        },
      }),
      ready: options.ready,
    },
  } as Nav);
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "dGVzdC1rZXk";
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a service worker that never becomes active", () => {
  it("gives up and reports an error, rather than waiting for the life of the page", async () => {
    // `ready` that never settles — exactly what the API promises when no
    // worker activates, and what left the button on "Enabling…".
    install({
      permission: async () => "granted" as NotificationPermission,
      ready: new Promise(() => {}),
    });

    const { registerWebPush } = await import("@/lib/push/client");
    const pending = registerWebPush();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(await pending).toEqual({ status: "error" });
  });
});

describe("a permission request that rejects rather than answering", () => {
  it("stays inside the status union instead of throwing past the caller", async () => {
    install({
      permission: async () => {
        throw new Error("permission request failed");
      },
      ready: Promise.resolve({}),
    });

    const { registerWebPush } = await import("@/lib/push/client");

    // The claim is that this RESOLVES. Before, it rejected, and the caller's
    // `setEnabling(false)` was never reached.
    await expect(registerWebPush()).resolves.toEqual({ status: "error" });
  });
});

describe("what must not change", () => {
  it("still refuses when the contractor denies permission", async () => {
    install({
      permission: async () => "denied" as NotificationPermission,
      ready: Promise.resolve({}),
    });

    const { registerWebPush } = await import("@/lib/push/client");

    expect(await registerWebPush()).toEqual({ status: "denied" });
  });

  it("still reports an unconfigured key rather than trying", async () => {
    install({
      permission: async () => "granted" as NotificationPermission,
      ready: Promise.resolve({}),
    });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    const { registerWebPush } = await import("@/lib/push/client");

    expect(await registerWebPush()).toEqual({ status: "no-key" });
  });
});
