import { describe, expect, it, vi } from "vitest";

// The single most important guarantee: instrumentation must NEVER throw into a
// user-facing flow, even when the database is completely broken. We point the
// admin client at a table that rejects every insert and the server client at a
// getUser that throws, then assert both helpers still resolve cleanly.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => Promise.reject(new Error("relation does not exist")),
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.reject(new Error("no cookies in this context")),
}));

import { trackEvent } from "./track";
import { logError } from "./errors";

describe("instrumentation never throws", () => {
  it("trackEvent resolves even when the insert rejects", async () => {
    await expect(
      trackEvent("quote_sent", { quote_id: "abc" }, { userId: "u1" }),
    ).resolves.toBeUndefined();
  });

  it("trackEvent resolves for an event not on the allowlist", async () => {
    await expect(
      trackEvent("totally_made_up_event", { x: 1 }),
    ).resolves.toBeUndefined();
  });

  it("logError resolves even when the insert rejects", async () => {
    await expect(
      logError("test_source", new Error("boom"), { path: "/jobs/new" }),
    ).resolves.toBeUndefined();
  });

  it("logError resolves for a non-Error value", async () => {
    await expect(logError("test_source", "a string error")).resolves.toBeUndefined();
  });
});
