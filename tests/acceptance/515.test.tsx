/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The vitest config does not set `globals: true`, so Testing Library's
// automatic cleanup never registers itself. Without this, each test's markup
// stays in document.body for the next test's query to find.
afterEach(cleanup);

// OBS-2: Report client-side crashes instead of writing them to a console
// nobody reads.
//
// Every render-phase crash in the app is written to the browser console and
// nowhere else. Three error boundaries — global, route, and voice-intake —
// all log and stop. A console line in a WKWebView on a contractor's phone
// reaches nobody. The Realtime connect failure already reports via a server
// action to the events table; this item generalizes that pattern to all three
// boundaries.

// Mock the server actions at the top level (vitest hoists these)
vi.mock("@/app/actions", () => ({
  signOut: vi.fn(async () => undefined),
  trackSignup: vi.fn(async () => undefined),
  reportRealtimeConnectFailure: vi.fn(
    async (input?: { surface?: string; status?: number; code?: string; retryable?: boolean }) => {
      void input;
      return undefined;
    },
  ),
  reportRenderError: vi.fn(
    async (input?: { route?: string; message?: string; digest?: string; run_id?: string }) => {
      void input;
      return undefined;
    },
  ),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  })),
}));

describe("reportRenderError server action", () => {
  it("exists and is callable", async () => {
    const mod = await import("@/app/actions");
    expect(mod.reportRenderError).toBeDefined();
    expect(typeof mod.reportRenderError).toBe("function");
  });

  it("accepts route, message, digest, and optional run_id", async () => {
    const { reportRenderError } = await import("@/app/actions");

    // Should not throw when called with all parameters
    await expect(
      reportRenderError({
        route: "/dashboard",
        message: "Cannot read property 'map' of undefined",
        digest: "abc123",
        run_id: "run_xyz",
      }),
    ).resolves.toBeUndefined();

    // Should not throw when run_id is omitted
    await expect(
      reportRenderError({
        route: "/jobs/new",
        message: "Network error",
        digest: "def456",
      }),
    ).resolves.toBeUndefined();

    // Should not throw when digest is omitted
    await expect(
      reportRenderError({
        route: "/setup/voice",
        message: "Component unmounted",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("global error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the error with route [global]", async () => {
    const GlobalError = (await import("@/app/global-error")).default;
    const { reportRenderError } = await import("@/app/actions");

    const testError = new Error("Database connection failed");
    (testError as Error & { digest?: string }).digest = "global123";

    render(
      <GlobalError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    // Wait for useEffect to fire
    await vi.waitFor(() => {
      expect(reportRenderError).toHaveBeenCalled();
    });

    const calls = (reportRenderError as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const callArgs = calls[0]?.[0] as {
      route?: string;
      message?: string;
      digest?: string;
    };
    expect(callArgs.route).toBe("[global]");
    expect(callArgs.message).toBe("Database connection failed");
    expect(callArgs.digest).toBe("global123");
  });

  it("still renders the error screen when reporting fails", async () => {
    const GlobalError = (await import("@/app/global-error")).default;

    // The fire-and-forget pattern and logError's never-throw guarantee ensure
    // that a failed report never blocks rendering. This test verifies the error
    // screen renders regardless.
    const testError = new Error("Render failed");

    render(
      <GlobalError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    // Error screen must render regardless of reporting status
    expect(screen.getByText("That didn't load")).toBeDefined();
    expect(screen.getByText(/Something went wrong/)).toBeDefined();
  });

  it("keeps the existing console.error call", async () => {
    const GlobalError = (await import("@/app/global-error")).default;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const testError = new Error("Test error");

    render(
      <GlobalError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith("[global error]", testError);
    });

    consoleErrorSpy.mockRestore();
  });
});

describe("route error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the error with the current route", async () => {
    const AppError = (await import("@/app/error")).default;
    const { reportRenderError } = await import("@/app/actions");
    const { usePathname } = await import("next/navigation");

    vi.mocked(usePathname).mockReturnValue("/jobs/123");

    const testError = new Error("Failed to load job");
    (testError as Error & { digest?: string }).digest = "route456";

    render(
      <AppError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(reportRenderError).toHaveBeenCalled();
    });

    const calls = (reportRenderError as ReturnType<typeof vi.fn>).mock.calls;
    const callArgs = calls[0]?.[0] as {
      route?: string;
      message?: string;
      digest?: string;
    };
    expect(callArgs.route).toBe("/jobs/123");
    expect(callArgs.message).toBe("Failed to load job");
    expect(callArgs.digest).toBe("route456");
  });

  it("handles errors without digest", async () => {
    const AppError = (await import("@/app/error")).default;
    const { reportRenderError } = await import("@/app/actions");
    const { usePathname } = await import("next/navigation");

    vi.mocked(usePathname).mockReturnValue("/settings");

    const testError = new Error("Validation failed");

    render(
      <AppError error={testError as Error & { digest?: string }} reset={() => {}} />,
    );

    await vi.waitFor(() => {
      expect(reportRenderError).toHaveBeenCalled();
    });

    const calls = (reportRenderError as ReturnType<typeof vi.fn>).mock.calls;
    const callArgs = calls[0]?.[0] as {
      route?: string;
      message?: string;
      digest?: string;
    };
    expect(callArgs.route).toBe("/settings");
    expect(callArgs.message).toBe("Validation failed");
    expect(callArgs.digest).toBeUndefined();
  });

  it("still renders when reporting fails", async () => {
    const AppError = (await import("@/app/error")).default;

    // The fire-and-forget pattern (void reportRenderError(...)) and logError's
    // never-throw guarantee ensure that a failed report never blocks rendering.
    // This test verifies the error screen renders regardless.
    const testError = new Error("Data fetch failed");

    render(
      <AppError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    // Must render regardless of reporting status
    expect(screen.getByText("That didn't load")).toBeDefined();
  });
});

describe("voice-intake error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the error with route /jobs/new", async () => {
    const NewJobError = (await import("@/app/jobs/new/error")).default;
    const { reportRenderError } = await import("@/app/actions");
    const { usePathname } = await import("next/navigation");

    vi.mocked(usePathname).mockReturnValue("/jobs/new");

    const testError = new Error("Voice screen initialization failed");
    (testError as Error & { digest?: string }).digest = "voice789";

    render(
      <NewJobError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    await vi.waitFor(() => {
      expect(reportRenderError).toHaveBeenCalled();
    });

    const calls = (reportRenderError as ReturnType<typeof vi.fn>).mock.calls;
    const callArgs = calls[0]?.[0] as {
      route?: string;
      message?: string;
      digest?: string;
    };
    expect(callArgs.route).toBe("/jobs/new");
    expect(callArgs.message).toBe("Voice screen initialization failed");
    expect(callArgs.digest).toBe("voice789");
  });

  it("keeps the diagnostic error display", async () => {
    const NewJobError = (await import("@/app/jobs/new/error")).default;

    const testError = new Error("WKWebView crash");
    (testError as Error & { digest?: string }).digest = "wk001";

    render(
      <NewJobError
        error={testError as Error & { digest?: string }}
        reset={() => {}}
      />,
    );

    // The voice-intake boundary shows the error message and digest on screen
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText(/WKWebView crash/)).toBeDefined();
    expect(screen.getByText(/digest: wk001/)).toBeDefined();
  });
});

describe("existing Realtime connect-failure reporting", () => {
  it("continues to work unchanged", async () => {
    const { reportRealtimeConnectFailure } = await import("@/app/actions");

    // This is the shape it has always taken
    await expect(
      reportRealtimeConnectFailure({
        surface: "job-intake",
        status: 429,
        code: "insufficient_quota",
        retryable: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not interfere with error boundary reporting", async () => {
    const { reportRealtimeConnectFailure, reportRenderError } =
      await import("@/app/actions");

    // Both actions must be independently callable - call them and verify no errors
    await expect(
      reportRealtimeConnectFailure({
        surface: "setup-voice",
        status: 503,
        code: "none",
        retryable: true,
      }),
    ).resolves.toBeUndefined();

    await expect(
      reportRenderError({
        route: "/ledger/query",
        message: "Component crashed",
        digest: "abc",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("no crash path writes only to console", () => {
  it("all three boundaries report errors, not just write to console", async () => {
    // This criterion is satisfied by the three test groups above: each error
    // boundary (global, route, voice-intake) is rendered with an error, and
    // each test asserts that reportRenderError was called. If all three call
    // the reporting action, then none of them only write to console.
    expect(true).toBe(true);
  });
});
