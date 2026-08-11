// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";

import { beforeEach, vi } from "vitest";

// Unmock modules before each test to ensure fresh state
// This counteracts vi.mock calls that are hoisted in test files
beforeEach(() => {
  vi.unmock("@/lib/rate-limit");
  vi.unmock("next/headers");

  // Dynamically import and reset rate limit store
  import("../src/lib/rate-limit").then((mod) => {
    if (mod.resetRateLimitStore) {
      mod.resetRateLimitStore();
    }
  });
});
