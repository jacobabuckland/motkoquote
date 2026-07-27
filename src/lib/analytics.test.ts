import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regression guard for the post-flip "Sending…" hang (#2). sendQuote flips the
// quote to "sent", then `await track("quote_sent")` at the very end. Product
// analytics is best-effort and must never wedge the flow that emitted it: a
// supabase call that HANGS (never resolves, never rejects) would slip past
// track's try/catch and leave the server action — hence the client — stuck
// forever, even though the real work is already done. track bounds its whole
// body with withTimeout(analytics), so here we fault-inject a hung auth.getUser
// and a hung events insert and assert track resolves anyway (never throws).
const h = vi.hoisted(() => ({
  // Toggled per test: when a step should hang, we hand back a never-settling
  // promise instead of resolving.
  hangGetUser: false,
  hangInsert: false,
}));

const never = () => new Promise<never>(() => {});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: () =>
        h.hangGetUser ? never() : Promise.resolve({ data: { user: { id: "u-1" } } }),
    },
    from: () => ({
      insert: () => (h.hangInsert ? never() : Promise.resolve({ error: null })),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  }),
}));

import { track } from "./analytics";
import { TIMEOUT_MS } from "@/lib/with-timeout";

describe("track — a hung supabase call never wedges the caller (#2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.hangGetUser = false;
    h.hangInsert = false;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resolves within the analytics budget when auth.getUser hangs", async () => {
    h.hangGetUser = true;
    let settled = false;
    const promise = track("quote_sent", { quote_id: "q-1" }).then(() => {
      settled = true;
    });
    // Before the budget elapses the write is still outstanding…
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.analytics - 1);
    expect(settled).toBe(false);
    // …and once withTimeout fires, track returns (swallowing the TimeoutError).
    await vi.advanceTimersByTimeAsync(2);
    await promise;
    expect(settled).toBe(true);
  });

  it("resolves within the analytics budget when the events insert hangs", async () => {
    h.hangInsert = true;
    const promise = track("quote_sent", { quote_id: "q-1" });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS.analytics + 1);
    // Must resolve (not reject) — a rejected track would surface as an unhandled
    // rejection in the server action; a hung one would wedge it.
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves promptly when supabase responds normally", async () => {
    const promise = track("quote_sent", { quote_id: "q-1" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });
});
