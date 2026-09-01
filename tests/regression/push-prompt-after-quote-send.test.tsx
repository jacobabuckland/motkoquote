/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  mockCapacitorPlugins,
  mockNativePlatform,
  mockPluginMethod,
} from "../helpers/capacitor";
import { ToastProvider } from "@/components/ui/toast";
import { PushPrompt } from "@/app/jobs/[id]/push-prompt";

// Before this component existed, `registerNativePush` had exactly one caller —
// the Settings button — so a contractor who never went looking got none of the
// seven money-moment alerts and was never asked. What is under test is the ask
// itself: that it appears on the device where it can work, stays out of the way
// everywhere else, and never spends the one iOS permission alert without a
// deliberate yes.

const renderPrompt = () =>
  render(
    <ToastProvider>
      <PushPrompt />
    </ToastProvider>,
  );

const HEADING = /Want to know the moment they accept\?/;

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.clear();
});

describe("the notification ask after a quote send", () => {
  it("asks on iOS while the permission is still undecided", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "prompt",
    }));

    renderPrompt();

    await waitFor(() => {
      expect(screen.getByText(HEADING)).toBeTruthy();
    });
  });

  it("does not spend the iOS alert until the contractor says yes", async () => {
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "prompt",
    }));
    // Declining at the system alert: a real settled outcome, and the one that
    // reaches a verdict without waiting on the APNs token round trip.
    mockPluginMethod("PushNotifications", "requestPermissions", () => ({
      receive: "denied",
    }));

    renderPrompt();
    await waitFor(() => {
      expect(screen.getByText(HEADING)).toBeTruthy();
    });

    // iOS shows its alert once per install. Merely rendering the card must not
    // be what spends it — that is the whole reason the soft ask exists.
    const asked = () =>
      mocks.PushNotifications.getCalls().filter(
        (call) => call.method === "requestPermissions",
      );
    expect(asked()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Yes, tell me" }));

    await waitFor(() => {
      expect(asked()).toHaveLength(1);
    });
    // And the contractor is told what happened rather than left on the card.
    await waitFor(() => {
      expect(screen.getByText(/blocked — enable them in iOS Settings/)).toBeTruthy();
    });
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("says nothing on the web, where no native permission exists", async () => {
    mockNativePlatform(false);
    mockCapacitorPlugins();

    renderPrompt();

    // Nothing to wait for — assert it stays absent across a turn of the loop.
    await Promise.resolve();
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("says nothing when notifications are already on", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "granted",
    }));

    renderPrompt();

    await Promise.resolve();
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("says nothing once iOS has been told no — that is not undoable from here", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "denied",
    }));

    renderPrompt();

    await Promise.resolve();
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("gives a second chance after one 'Not now', then stops asking", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "prompt",
    }));

    // First send: asked, declined.
    renderPrompt();
    await waitFor(() => expect(screen.getByText(HEADING)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull());
    cleanup();

    // A later send: asked again, because a card under a freshly sent quote is
    // easy to dismiss without reading and one mistap should not be final.
    renderPrompt();
    await waitFor(() => expect(screen.getByText(HEADING)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText(HEADING)).toBeNull());
    cleanup();

    // Third send: they have answered twice. Settings still has the control.
    renderPrompt();
    await Promise.resolve();
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("still asks when localStorage cannot be read", async () => {
    mockNativePlatform(true);
    mockCapacitorPlugins();
    mockPluginMethod("PushNotifications", "checkPermissions", () => ({
      receive: "prompt",
    }));
    // Private browsing and blocked site data make this throw rather than
    // return null. Failing closed there would silently never ask.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    renderPrompt();

    await waitFor(() => {
      expect(screen.getByText(HEADING)).toBeTruthy();
    });
    vi.restoreAllMocks();
  });
});
