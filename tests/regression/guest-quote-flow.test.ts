import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  clientIpKey,
  recordRateLimitUse,
  __resetRateLimitState,
} from "@/lib/rate-limit";
import { EMPTY_SOW_STATE, mergeSowToolDelta, sowStateSchema } from "@/lib/schemas/sow";

const SRC = path.join(process.cwd(), "src");
const read = (relative: string): string => readFileSync(path.join(SRC, relative), "utf8");

describe("guest token mint rate limiting (fail-closed)", () => {
  beforeEach(() => {
    __resetRateLimitState();
  });

  it("allows up to the limit and rejects beyond it", () => {
    const opts = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("a", opts).allowed).toBe(true);
      recordRateLimitUse("a", opts);
    }

    const fourth = checkRateLimit("a", opts);
    expect(fourth.allowed).toBe(false);
    expect(fourth.allowed === false && fourth.reason).toBe("over_limit");
    expect(fourth.allowed === false && fourth.reason === "over_limit" && fourth.retryAfterSeconds)
      .toBeGreaterThan(0);
  });

  it("does not spend the allowance on a check alone", () => {
    // The defect this guards: charging a caller for an attempt that failed
    // upstream. Checking is free; only a granted token costs anything.
    const opts = { limit: 2, windowMs: 60_000 };
    for (let i = 0; i < 20; i += 1) {
      expect(checkRateLimit("a", opts).allowed, `check ${i} was refused`).toBe(true);
    }

    // Two successes later, and only then, the caller is out of allowance.
    recordRateLimitUse("a", opts);
    expect(checkRateLimit("a", opts).allowed).toBe(true);
    recordRateLimitUse("a", opts);
    expect(checkRateLimit("a", opts).allowed).toBe(false);
  });

  it("keys callers independently", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("a", opts).allowed).toBe(true);
    recordRateLimitUse("a", opts);
    expect(checkRateLimit("b", opts).allowed).toBe(true);
    expect(checkRateLimit("a", opts).allowed).toBe(false);
  });

  it("rejects rather than allows when it cannot identify or track a caller", () => {
    // An empty key means the limiter cannot bound this caller at all. The
    // fail-closed posture makes that a denial, not a free pass.
    const decision = checkRateLimit("", { limit: 10, windowMs: 60_000 });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe("unavailable");
  });

  it("takes the proxy-appended hop, not the client-supplied prefix of x-forwarded-for", () => {
    // A caller can send their own x-forwarded-for; our edge appends the real
    // peer. Trusting the FIRST entry would let them rotate it and evade the
    // limit entirely, so the LAST entry is the one used.
    const spoofed = new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" });
    expect(clientIpKey(spoofed)).toBe("9.9.9.9");

    // x-real-ip is set by the platform and is not forwardable — prefer it.
    const both = new Headers({
      "x-forwarded-for": "1.1.1.1, 9.9.9.9",
      "x-real-ip": "8.8.8.8",
    });
    expect(clientIpKey(both)).toBe("8.8.8.8");
  });

  it("groups unidentified callers into one bucket rather than exempting them", () => {
    expect(clientIpKey(new Headers())).toBe("unidentified");
  });
});

describe("guest flow writes nothing to Supabase — structurally", () => {
  // The point of these is that "zero writes" is a property of what the guest
  // modules are ABLE to do, not a promise about what they currently choose to
  // do. A Supabase import appearing in any of them is the regression.
  const GUEST_MODULES = [
    "lib/guest/quote.ts",
    "lib/guest/session.ts",
    "lib/guest/pdf.ts",
    "app/start/actions.ts",
    "app/api/guest/realtime-session/route.ts",
  ];

  it.each(GUEST_MODULES)("%s imports no Supabase client", (relative) => {
    const source = read(relative);
    expect(source).not.toMatch(/@supabase\//);
    expect(source).not.toMatch(/lib\/supabase\//);
  });

  it("the guest drafting core reaches no database helper transitively", () => {
    // @/lib/knowledge, @/lib/materials, @/lib/quote-learning and @/lib/analytics
    // all open a Supabase client. The authenticated draft calls them; the guest
    // draft must not.
    const source = read("lib/guest/quote.ts");
    for (const forbidden of [
      "@/lib/knowledge",
      "@/lib/materials",
      "@/lib/quote-learning",
      "@/lib/analytics",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("the guest realtime route mints a token and touches no table", () => {
    const source = read("app/api/guest/realtime-session/route.ts");
    expect(source).toContain("createRealtimeClientSecret");
    expect(source).not.toMatch(/\.from\(/);
    expect(source).not.toMatch(/insert|update|upsert|delete/);
  });
});

describe("guest routes are reachable without a session", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  });

  it("middleware lets an anonymous visitor through to the guest flow", async () => {
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
    }));
    const { updateSession } = await import("@/lib/supabase/middleware");

    const requestFor = (pathname: string) =>
      ({
        nextUrl: {
          pathname,
          clone: () => new URL(`http://localhost:3000${pathname}`),
        },
        url: `http://localhost:3000${pathname}`,
        cookies: { getAll: () => [], set: () => {} },
      }) as unknown as Parameters<typeof updateSession>[0];

    for (const pathname of ["/start", "/start/quote", "/api/guest/realtime-session"]) {
      const response = await updateSession(requestFor(pathname));
      // A redirect to /login would be a 307; passing through is a 200.
      expect(response.status, `${pathname} was gated`).not.toBe(307);
      expect(response.headers.get("location"), `${pathname} redirected`).toBeNull();
    }
  });

  it("still redirects an anonymous visitor away from account surfaces", async () => {
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      }),
    }));
    const { updateSession } = await import("@/lib/supabase/middleware");

    const request = {
      nextUrl: {
        pathname: "/dashboard",
        clone: () => new URL("http://localhost:3000/dashboard"),
      },
      url: "http://localhost:3000/dashboard",
      cookies: { getAll: () => [], set: () => {} },
    } as unknown as Parameters<typeof updateSession>[0];

    const response = await updateSession(request);
    expect(response.headers.get("location")).toContain("/login");
  });
});

describe("entry path", () => {
  it("the native shell's cold launch goes to voice capture, not signup", () => {
    const source = read("app/(marketing)/page.tsx");
    expect(source).toContain('if (userAgent.includes("MotkoApp")) redirect("/start")');
    expect(source).not.toContain('redirect("/signup")');
    // The authenticated launch is untouched.
    expect(source).toContain('if (user) redirect("/dashboard")');
  });

  it("the native resume gate no longer pushes a guest to /login", () => {
    const source = read("components/native-app-init.tsx");
    expect(source).toContain('"/start"');
    // Both guards, not either: the route check AND a live guest artefact.
    expect(source).toContain("!isPublicRoute && !hasGuestArtefact()");
  });
});

describe("no new native dependencies", () => {
  it("package.json has no filesystem plugin and share is still unused", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };

    expect(Object.keys(pkg.dependencies)).not.toContain("@capacitor/filesystem");
    // The guest share path uses the web navigator.share, which needs no pod and
    // therefore no `cap sync` and no new binary.
    expect(read("app/start/quote/page.tsx")).toContain("navigator.canShare");
    expect(read("app/start/quote/page.tsx")).not.toContain("@capacitor/share");
  });
});

describe("the guest SoW survives the server-action boundary", () => {
  // The guest merges deltas client-side and posts the whole SoW to the drafting
  // action, which re-validates it with sowStateSchema. A mismatch between what
  // mergeSowToolDelta produces and what that schema accepts would only surface
  // as a runtime failure mid-quote, so it is pinned here.
  it("validates an empty state", () => {
    expect(() => sowStateSchema.parse(EMPTY_SOW_STATE)).not.toThrow();
  });

  it("validates a merged state after a JSON round trip", () => {
    const merged = mergeSowToolDelta(null, {
      job_type: "Full rewire",
      rooms: [{ name: "Downstairs", work_items: ["ten double sockets"] }],
      customer_name: "Luca Feser",
      labour_plan: { crew_description: "just me" },
      pricing: { mode: "days" },
      materials_supply: { contractor_supplies: ["cable"] },
    });
    const next = mergeSowToolDelta(merged, { deadline: { job_by: "end of March" } });

    expect(() => sowStateSchema.parse(next)).not.toThrow();
    expect(() => sowStateSchema.parse(JSON.parse(JSON.stringify(next)))).not.toThrow();
  });
});
