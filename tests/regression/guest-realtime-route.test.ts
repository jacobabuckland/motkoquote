import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Criterion 10 has two halves: reject beyond the limit, AND reject when the
// limiter itself cannot answer. The second is the one that matters — an
// unbounded OpenAI spend by anyone who finds the endpoint is the worse failure,
// so the route must fail CLOSED rather than wave callers through on a fault.

const requestWith = (headers: Record<string, string> = {}): NextRequest =>
  ({ headers: new Headers(headers) }) as unknown as NextRequest;

describe("POST /api/guest/realtime-session", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("@/lib/rate-limit");
    vi.doUnmock("@/lib/realtime");
  });

  it("denies with 503 when the limiter cannot answer", async () => {
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({ allowed: false, reason: "unavailable" }),
      recordRateLimitUse: vi.fn(),
    }));
    const mint = vi.fn();
    vi.doMock("@/lib/realtime", () => ({ createRealtimeClientSecret: mint }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    const response = await POST(requestWith());

    expect(response.status).toBe(503);
    // Critically: no token was minted, so no credit was spent.
    expect(mint).not.toHaveBeenCalled();
  });

  it("denies with 429 and a Retry-After once over the limit", async () => {
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({
        allowed: false,
        reason: "over_limit",
        retryAfterSeconds: 900,
      }),
      recordRateLimitUse: vi.fn(),
    }));
    const mint = vi.fn();
    vi.doMock("@/lib/realtime", () => ({ createRealtimeClientSecret: mint }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    const response = await POST(requestWith());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("900");
    expect(mint).not.toHaveBeenCalled();
  });

  it("never offers an account as the remedy for being rate limited", async () => {
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({
        allowed: false,
        reason: "over_limit",
        retryAfterSeconds: 60,
      }),
      recordRateLimitUse: vi.fn(),
    }));
    vi.doMock("@/lib/realtime", () => ({ createRealtimeClientSecret: vi.fn() }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    const body = (await (await POST(requestWith())).json()) as { error: string };

    // Suggesting signup to get past a limiter reads as a paywall on the free
    // path, which is the finding this whole flow exists to answer.
    expect(body.error).not.toMatch(/account|sign ?up|sign ?in|register/i);
  });

  it("mints a token with the base prompt and no account-only tools", async () => {
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({ allowed: true, remaining: 4 }),
      recordRateLimitUse: vi.fn(),
    }));
    const mint = vi.fn(async (_config: { instructions: string; tools: { name: string }[] }) => "secret-123");
    vi.doMock("@/lib/realtime", () => ({ createRealtimeClientSecret: mint }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    const response = await POST(requestWith({ "x-real-ip": "1.2.3.4" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clientSecret: "secret-123" });

    const config = mint.mock.calls[0]?.[0];
    const toolNames = config?.tools.map((tool) => tool.name) ?? [];
    // No tool a guest is offered may imply a database write.
    expect(toolNames).toEqual(["update_sow", "finish_job", "wrap_up"]);
    expect(toolNames).not.toContain("record_first_name");
    expect(toolNames).not.toContain("record_person");

    // The must-ask pricing-slot invariant applies to a guest exactly as it does
    // to a signed-in trade (see CLAUDE.md) — it is not a personalisation.
    expect(config?.instructions).toContain("The pricing question in particular is not optional");
    expect(config?.instructions).toContain(
      "crew, how it's priced, materials, and when they're doing it",
    );
    // ...but nothing is fabricated in place of the personalisation they lack.
    expect(config?.instructions).not.toMatch(/Default to assuming this is a/);
    expect(config?.instructions).not.toMatch(/Known context about this contractor/);
  });

  it("spends the allowance only when a token was actually minted", async () => {
    const record = vi.fn();
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({ allowed: true, remaining: 4 }),
      recordRateLimitUse: record,
    }));
    vi.doMock("@/lib/realtime", () => ({
      createRealtimeClientSecret: async () => "secret-123",
    }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    expect((await POST(requestWith())).status).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("does not spend the allowance when the mint fails upstream", async () => {
    // The defect: five transient OpenAI outages used to lock a guest — or an
    // App Store reviewer — out for an hour over failures they didn't cause.
    const record = vi.fn();
    vi.doMock("@/lib/rate-limit", () => ({
      clientIpKey: () => "1.2.3.4",
      checkRateLimit: () => ({ allowed: true, remaining: 4 }),
      recordRateLimitUse: record,
    }));
    vi.doMock("@/lib/realtime", () => ({
      createRealtimeClientSecret: async () => {
        throw new Error("OpenAI 503");
      },
    }));

    const { POST } = await import("@/app/api/guest/realtime-session/route");
    expect((await POST(requestWith())).status).toBe(502);
    expect(record).not.toHaveBeenCalled();
  });
});
