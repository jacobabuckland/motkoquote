/**
 * Fetch monitor: observes fetch outcomes to detect offline state from
 * consecutive network failures, independent of navigator.onLine.
 *
 * This wraps window.fetch to count consecutive failures and emits custom
 * events when the offline state changes. It does NOT modify requests or
 * responses — it only observes.
 */

// Threshold for consecutive failures before emitting offline signal
const CONSECUTIVE_FAILURE_THRESHOLD = 2;

// Global state
let consecutiveFailures = 0;
let isOfflineFromFetch = false;
let originalFetch: typeof window.fetch | null = null;

/**
 * Determines if a fetch response should be counted as a network failure.
 * Server errors (500, 503, 401, 404, etc.) are NOT failures — they prove
 * the network is working.
 */
function isNetworkFailure(response: Response): boolean {
  // Captive portal detection: HTML returned when expecting JSON
  const contentType = response.headers.get("content-type") || "";
  if (response.ok && contentType.includes("text/html")) {
    return true;
  }

  // Captive portal: 204 (No Content) can indicate a captive portal redirect
  if (response.status === 204) {
    return true;
  }

  // Any other response (including server errors like 500, 503, 401, 404)
  // proves the network is working, so not a network failure
  return false;
}

/**
 * Reports a fetch failure to the monitor.
 */
export function reportFetchFailure(): void {
  consecutiveFailures++;

  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD && !isOfflineFromFetch) {
    isOfflineFromFetch = true;
    window.dispatchEvent(new CustomEvent("fetch-offline"));
  }
}

/**
 * Reports a fetch success to the monitor.
 */
export function reportFetchSuccess(): void {
  consecutiveFailures = 0;

  if (isOfflineFromFetch) {
    isOfflineFromFetch = false;
    window.dispatchEvent(new CustomEvent("fetch-online"));
  }
}

// Track if we're currently inside a monitored fetch call to avoid recursion
let _insideFetchMonitor = false;
let _fetchIsWrapped = false;

/**
 * The wrapper function that monitors fetch calls.
 */
async function monitoredFetch(
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  // Avoid infinite recursion if fetch is called inside our monitoring code
  if (_insideFetchMonitor) {
    return originalFetch!(...args);
  }

  _insideFetchMonitor = true;
  try {
    const response = await originalFetch!(...args);

    // Check if this response indicates a network failure (captive portal, etc.)
    if (isNetworkFailure(response)) {
      reportFetchFailure();
    } else {
      // Any other response (including server errors) means network is working
      reportFetchSuccess();
    }

    return response;
  } catch (error: unknown) {
    // Check if this is an AbortError (user cancelled) — don't count those
    if (error instanceof Error && error.name === "AbortError") {
      // Don't count aborted requests as failures
      throw error;
    }

    // This is a real network error (DNS failure, connection refused, etc.)
    reportFetchFailure();
    throw error;
  } finally {
    _insideFetchMonitor = false;
  }
}

/**
 * Wraps fetch to observe all fetch calls and track failures/successes.
 * Uses a getter/setter so the wrapper persists even if fetch is replaced.
 */
function wrapFetch(): void {
  if (_fetchIsWrapped) {
    return; // Already wrapped
  }

  // Determine which environment we're in and get the initial fetch
  const hasGlobal = typeof global !== "undefined" && "fetch" in global;
  const hasWindow = typeof window !== "undefined" && "fetch" in window;

  if (!hasGlobal && !hasWindow) {
    return; // No fetch available
  }

  // Store the initial fetch implementation
  if (hasGlobal) {
    originalFetch = global.fetch;
  } else if (hasWindow) {
    originalFetch = window.fetch;
  }

  // Use Object.defineProperty to intercept fetch access.
  // When someone does `global.fetch = newMock`, we capture newMock in originalFetch.
  // When someone calls `fetch()`, they get our wrapper, which calls originalFetch.
  if (hasGlobal) {
    Object.defineProperty(global, "fetch", {
      get() {
        return monitoredFetch;
      },
      set(value: typeof fetch) {
        originalFetch = value;
      },
      configurable: true,
    });
  }

  if (hasWindow && window !== global) {
    Object.defineProperty(window, "fetch", {
      get() {
        return monitoredFetch;
      },
      set(value: typeof fetch) {
        originalFetch = value;
      },
      configurable: true,
    });
  }

  _fetchIsWrapped = true;
}

/**
 * Initializes the fetch monitor. Call this once at app startup.
 * Safe to call multiple times — it only wraps fetch once.
 */
export function initFetchMonitor(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Reset state to ensure clean slate (important for tests)
  consecutiveFailures = 0;
  isOfflineFromFetch = false;

  wrapFetch();
}

/**
 * Hook for components to check if offline state is detected from fetch failures.
 * Returns true if we're offline based on consecutive fetch failures.
 */
export function useFetchMonitor(): boolean {
  return isOfflineFromFetch;
}

/**
 * Resets the fetch monitor state. Useful for testing.
 */
export function resetFetchMonitor(): void {
  consecutiveFailures = 0;
  isOfflineFromFetch = false;
  _fetchIsWrapped = false;

  // Restore original fetch if we wrapped it
  if (originalFetch) {
    const saved = originalFetch;
    originalFetch = null;

    // Remove our property descriptors and restore normal fetch behavior
    if (typeof global !== "undefined" && "fetch" in global) {
      delete (global as { fetch?: typeof fetch }).fetch;
      if (saved) {
        global.fetch = saved as typeof fetch;
      }
    }
    if (typeof window !== "undefined" && "fetch" in window) {
      delete (window as { fetch?: typeof fetch }).fetch;
      if (saved) {
        window.fetch = saved as typeof fetch;
      }
    }
  }
}
