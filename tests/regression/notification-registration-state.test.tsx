/**
 * @vitest-environment happy-dom
 */

// Reported from the live app: "the UI is very confusing as when the
// notifications are accepted it doesn't feed into the settings page".
//
// The Notifications section had no notion of its own state. SettingsClient took
// exactly one prop — which events are MUTED — and was never told whether any
// device was registered; settings/page.tsx read notification_preferences and
// never touched push_subscriptions. So the button read "Enable notifications"
// before permission was granted and "Enable notifications" after, and the only
// acknowledgement was a toast that vanished in three seconds.
//
// The obvious next move for a trade who sees no change is to tap it again,
// which re-runs registration and produces another identical toast. There was no
// state on the page that could ever end that loop.
//
// It also hid a second problem: with no persistent state, "registration failed"
// and "registration worked and the UI never said so" look identical, which is
// why the separate registration-failure ticket has been hard to pin down.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

const registerWebPush = vi.hoisted(() => vi.fn());
const registerNativePush = vi.hoisted(() => vi.fn());

// The component branches on isNativeApp(), and the shared Capacitor helper's
// mockNativePlatform only covers the @capacitor/core export — src/lib/platform
// does not read that, it inspects window.Capacitor. Mocking the module is the
// pattern already established for this in
// tests/regression/native-push-registration.test.ts. Held in a hoisted object
// so it can be toggled per test rather than fixed for the file.
const shell = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/platform", () => ({
  isNativeApp: () => shell.native,
  getPlatform: () => (shell.native ? "ios" : "web"),
}));

vi.mock("@/lib/push/client", () => ({
  isWebPushSupported: () => true,
  registerWebPush,
  sendTestNotification: async () => ({ devices: 1, sent: 1, failed: 0 }),
}));

vi.mock("@/lib/push/native", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/push/native")>();
  return { ...original, registerNativePush };
});

vi.mock("@/app/settings/actions", () => ({
  saveNotificationPreferences: async () => {},
}));

const mount = async (registrations: string[]) => {
  const { SettingsClient } = await import("@/app/settings/settings-client");
  const { ToastProvider } = await import("@/components/ui/toast");
  render(
    <ToastProvider>
      <SettingsClient initialDisabledEvents={[]} initialRegistrations={registrations} />
    </ToastProvider>,
  );
};

const state = () => screen.getByTestId("push-state").textContent ?? "";

describe("what the section says on load", () => {
  beforeEach(() => {
    shell.native = false;
    // Defaults rather than mockReset(): a reset mock returns undefined, so a
    // call down the branch a test did NOT intend crashes on `result.status`
    // instead of failing an assertion. "error" is a real status that leaves the
    // indicator off, so a wrong-path call shows up as a state mismatch.
    registerWebPush.mockResolvedValue({ status: "error" });
    registerNativePush.mockResolvedValue({ status: "error" });
  });

  it("says nothing is switched on when no device is registered", async () => {
    await mount([]);
    expect(state()).toMatch(/not switched on/i);
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeDefined();
  });

  it("says push is on when this device's platform is registered", async () => {
    // The whole defect: this had no way to be true before, because the
    // component was never told.
    await mount(["webpush"]);
    expect(state()).toMatch(/on for this device/i);
  });

  it("does not claim this device is covered because another one is", async () => {
    // Per-device, not per-account. A trade with the phone registered and the
    // laptop not is in both states at once, and the rows are per user_id
    // across platforms — so an account-wide tick would be wrong on the machine
    // being looked at, which is the same class of lie as a button that never
    // changes.
    await mount(["apns"]);
    expect(state()).toMatch(/not on for this device/i);
    expect(state()).toMatch(/1 other device/i);
  });

  it("reads the native platform's own rows on a device", async () => {
    shell.native = true;
    await mount(["apns"]);
    expect(state()).toMatch(/on for this device/i);
  });

  it("counts several devices without pretending they are one", async () => {
    await mount(["webpush", "apns"]);
    expect(state()).toMatch(/on for this device/i);
    expect(screen.getByText(/Registered on 2 devices/)).toBeDefined();
  });
});

describe("accepting the permission changes the page, without a reload", () => {
  beforeEach(() => {
    shell.native = false;
    // Defaults rather than mockReset(): a reset mock returns undefined, so a
    // call down the branch a test did NOT intend crashes on `result.status`
    // instead of failing an assertion. "error" is a real status that leaves the
    // indicator off, so a wrong-path call shows up as a state mismatch.
    registerWebPush.mockResolvedValue({ status: "error" });
    registerNativePush.mockResolvedValue({ status: "error" });
  });

  it("flips to on after a successful registration", async () => {
    registerWebPush.mockResolvedValue({ status: "subscribed" });
    await mount([]);
    expect(state()).toMatch(/not switched on/i);

    fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));

    // The row is written server-side, so before this a reload was the only way
    // to see it — and "nothing changes without one" is the entire complaint.
    await waitFor(() => expect(state()).toMatch(/on for this device/i));
  });

  it("flips to on after a successful native registration", async () => {
    shell.native = true;
    registerNativePush.mockResolvedValue({ status: "registered" });
    await mount([]);

    fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => expect(state()).toMatch(/on for this device/i));
  });

  it("stays off when registration fails, whatever the toast said", async () => {
    // Showing "on" for a registration that did not happen is worse than showing
    // nothing: delivery depends on the row existing, not on the prompt being
    // accepted. This is also the case most easily mistaken for the defect being
    // fixed — permission granted at the OS level, row never written.
    registerWebPush.mockResolvedValue({ status: "error" });
    await mount([]);

    fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => expect(registerWebPush).toHaveBeenCalled());
    expect(state()).toMatch(/not switched on/i);
  });

  it("stays off when the browser denied permission", async () => {
    registerWebPush.mockResolvedValue({ status: "denied" });
    await mount([]);

    fireEvent.click(screen.getByRole("button", { name: "Enable notifications" }));

    await waitFor(() => expect(registerWebPush).toHaveBeenCalled());
    expect(state()).toMatch(/not switched on/i);
  });
});

describe("the button stops repeating a call to action already answered", () => {
  beforeEach(() => {
    shell.native = false;
    registerWebPush.mockResolvedValue({ status: "error" });
    registerNativePush.mockResolvedValue({ status: "error" });
  });

  it("offers a re-register rather than 'Enable notifications' once on", async () => {
    await mount(["webpush"]);
    expect(screen.queryByRole("button", { name: "Enable notifications" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Re-register this device" }),
    ).toBeDefined();
  });
});

describe("the preference checkboxes", () => {
  beforeEach(() => {
    shell.native = false;
    registerWebPush.mockResolvedValue({ status: "error" });
    registerNativePush.mockResolvedValue({ status: "error" });
  });

  it("say what they apply to when push is off, and stay usable", async () => {
    // Annotated, never disabled: these govern email as well as push, so a
    // trade with no registered device still has reason to set them. Before,
    // they were fully interactive with nothing saying push was off — so
    // preferences got tuned for a channel that could not deliver.
    await mount([]);
    expect(screen.getByText(/these apply to your emails/i)).toBeDefined();

    const box = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(box.disabled).toBe(false);
  });

  it("drop the note once push is on", async () => {
    await mount(["webpush"]);
    expect(screen.queryByText(/these apply to your emails/i)).toBeNull();
  });
});
