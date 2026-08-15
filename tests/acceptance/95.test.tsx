/**
 * @vitest-environment happy-dom
 *
 * Issue #95: Add app lifecycle resume handling with session revalidation
 *
 * These tests verify that the app registers an appStateChange listener,
 * revalidates the Supabase session on resume, and refreshes the current route
 * when appropriate. They test the threshold logic, exempted routes, and edge
 * cases around expired sessions and network failures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";
import { NativeAppInit } from "@/components/native-app-init";

// Required for Testing Library cleanup
afterEach(cleanup);

// Mock Next.js navigation
const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  usePathname: () => mockPathname,
}));

// Mock Supabase client
const mockGetSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
  }),
}));

// Mock platform detection - default to native
let mockIsNative = true;
vi.mock("@/lib/platform", () => ({
  isNativeApp: () => mockIsNative,
}));

// Mock push notification init (NativeAppInit calls this)
vi.mock("@/lib/push/native", () => ({
  initNativePush: vi.fn(() => Promise.resolve()),
}));

describe("Issue #95: App lifecycle resume handling with session revalidation", () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockPush.mockReset();
    mockRefresh.mockReset();
    mockGetSession.mockReset();

    // Reset mock state
    mockPathname = "/dashboard";
    mockIsNative = true;

    // Default: valid session
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: "test-user" } } },
      error: null,
    });

    // Mock timers for threshold testing
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Listener registration", () => {
    it("registers an appStateChange listener on mount", () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      render(<NativeAppInit />);

      // Assert the App plugin's addListener method was called with "appStateChange"
      const calls = mocks.App.getCalls();
      const listenerCall = calls.find((call) => call.method === "addListener");

      expect(listenerCall).toBeDefined();
      expect(listenerCall?.args[0]).toBe("appStateChange");
      expect(typeof listenerCall?.args[1]).toBe("function");
    });

    it("removes the listener on unmount", () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      const { unmount } = render(<NativeAppInit />);

      // Find the listener handle returned by addListener
      const addListenerCalls = mocks.App.getCalls().filter(
        (call) => call.method === "addListener"
      );
      expect(addListenerCalls.length).toBeGreaterThan(0);

      unmount();

      // Assert that remove() was called on the listener handle
      // The mock should record a "remove" call or similar cleanup method
      // This is a simplified check; the actual implementation may vary
      const removeCalls = mocks.App.getCalls().filter(
        (call) => call.method === "remove"
      );

      // If the Capacitor plugin returns a handle with a remove() method,
      // we expect that method to have been called
      expect(removeCalls.length).toBeGreaterThan(0);
    });

    it("does not register a listener on web platform", () => {
      mockNativePlatform(false);
      mockIsNative = false;
      const mocks = mockCapacitorPlugins();

      render(<NativeAppInit />);

      const calls = mocks.App.getCalls();
      const listenerCall = calls.find((call) => call.method === "addListener");

      expect(listenerCall).toBeUndefined();
    });
  });

  describe("Session revalidation on resume", () => {
    it("calls getSession when app becomes active", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      render(<NativeAppInit />);

      // Find the listener callback
      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      // Simulate app going to background
      listener({ isActive: false });

      // Advance time beyond threshold (assume 30s default)
      vi.advanceTimersByTime(31_000);

      // Simulate app becoming active
      await listener({ isActive: true });

      // Wait for async session check
      await vi.runAllTimersAsync();

      expect(mockGetSession).toHaveBeenCalled();
    });

    it("does not check session if backgrounded for less than threshold", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      // Simulate app going to background
      listener({ isActive: false });

      // Advance time within threshold (e.g. 10 seconds)
      vi.advanceTimersByTime(10_000);

      // Simulate app becoming active
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      // Session should not be checked because threshold not met
      expect(mockGetSession).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe("Expired session handling", () => {
    it("redirects to login with redirect param when session is expired", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Mock expired session (no user)
      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      // Mock current pathname
      mockPathname = "/jobs/abc123";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockPush).toHaveBeenCalledWith("/login?redirect=%2Fjobs%2Fabc123");
    });

    it("does not redirect to login on public routes when session is expired", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: null },
        error: null,
      });

      // Mock a public customer-facing route
      mockPathname = "/q/quote123";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      // Should not redirect to login
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("does not redirect on failed session check (network error)", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      // Mock network error
      mockGetSession.mockRejectedValue(new Error("Network error"));

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      // Should not redirect on error
      expect(mockPush).not.toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe("Route refresh on valid session", () => {
    it("calls router.refresh when session is valid and threshold is met", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).toHaveBeenCalled();
    });

    it("does not refresh when threshold is not met", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(10_000); // Less than threshold
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe("Exempted routes do not refresh", () => {
    it("does not refresh voice route even when threshold is met", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      // Mock voice route
      mockPathname = "/setup/voice";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      // Session should be checked but refresh should not happen
      expect(mockGetSession).toHaveBeenCalled();
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("does not refresh job voice route", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/jobs/new";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("does not refresh invoice payment route (mid-payment)", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/i/invoice123";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("does not refresh job detail route (unsaved form)", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/jobs/job123";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("does not refresh setup route (unsaved form)", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/setup";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it("does not refresh login route", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/login";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });

  describe("Refeshable routes DO refresh", () => {
    it("refreshes dashboard route when threshold is met", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/dashboard";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).toHaveBeenCalled();
    });

    it("refreshes settings route when threshold is met", async () => {
      mockNativePlatform(true);
      const mocks = mockCapacitorPlugins();

      mockGetSession.mockResolvedValue({
        data: { session: { user: { id: "test-user" } } },
        error: null,
      });

      mockPathname = "/settings";

      render(<NativeAppInit />);

      const addListenerCall = mocks.App.getCalls().find(
        (call) => call.method === "addListener" && call.args[0] === "appStateChange"
      );
      const listener = addListenerCall?.args[1] as (state: { isActive: boolean }) => void;

      listener({ isActive: false });
      vi.advanceTimersByTime(31_000);
      await listener({ isActive: true });
      await vi.runAllTimersAsync();

      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
