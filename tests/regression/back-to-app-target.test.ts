import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A back control on a public page must return the reader INTO the app. It used
// to point at "/" and rely on the root route redirecting — which works only for
// as long as "/" belongs to us. Once the root redirect to the marketing domain
// lands, a "/" back target would eject a signed-in contractor onto an external
// domain mid-session. These tests bind the resolved destinations, and bind the
// native-shell User-Agent tag to the two other places it is written down.

type MockUser = { id: string } | null;

let mockUser: MockUser = null;
let mockUserAgent = "";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockUser } }),
    },
  }),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "user-agent" ? mockUserAgent : null),
  }),
}));

const NATIVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) MotkoApp";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";

describe("resolveAppHomeHref", () => {
  beforeEach(() => {
    mockUser = null;
    mockUserAgent = "";
  });

  it("sends a signed-in contractor to the dashboard", async () => {
    const { resolveAppHomeHref } = await import("@/lib/app-home");
    mockUser = { id: "contractor-1" };
    mockUserAgent = BROWSER_UA;

    expect(await resolveAppHomeHref()).toBe("/dashboard");
  });

  it("sends a signed-in contractor to the dashboard inside the native shell", async () => {
    const { resolveAppHomeHref } = await import("@/lib/app-home");
    mockUser = { id: "contractor-1" };
    mockUserAgent = NATIVE_UA;

    expect(await resolveAppHomeHref()).toBe("/dashboard");
  });

  it("sends a guest inside the native shell to voice capture, never to marketing", async () => {
    const { resolveAppHomeHref } = await import("@/lib/app-home");
    mockUserAgent = NATIVE_UA;

    expect(await resolveAppHomeHref()).toBe("/start");
  });

  it("leaves a guest in a browser on the root landing page", async () => {
    const { resolveAppHomeHref } = await import("@/lib/app-home");
    mockUserAgent = BROWSER_UA;

    expect(await resolveAppHomeHref()).toBe("/");
  });
});

describe("the native-shell User-Agent tag", () => {
  // The tag is written in three places: the Capacitor config that stamps it,
  // the root route that reads it, and the helper above. capacitor.config.ts is
  // frozen behind an accepted App Store submission and the root route is frozen
  // behind a 5.1.1(v) review, so neither can be refactored to a shared export —
  // this test is what keeps the three copies honest.
  const appendUserAgent = /appendUserAgent:\s*"([^"]+)"/.exec(
    readFileSync("capacitor.config.ts", "utf8"),
  )?.[1];

  it("is stamped by capacitor.config.ts", () => {
    expect(appendUserAgent).toBe("MotkoApp");
  });

  it("is the same tag the root route branches on", () => {
    const root = readFileSync("src/app/(marketing)/page.tsx", "utf8");
    expect(root).toContain(`userAgent.includes("${appendUserAgent}")`);
  });

  it("is the same tag the back-target helper branches on", () => {
    const helper = readFileSync("src/lib/app-home.ts", "utf8");
    expect(helper).toContain(`NATIVE_SHELL_UA_TAG = "${appendUserAgent}"`);
  });
});

describe("no in-app screen links back to root", () => {
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["src/app/privacy/page.tsx", "backHref={backHref}"],
    ["src/app/support/page.tsx", "backHref={backHref}"],
    ["src/app/jobs/new/error.tsx", 'backHref="/dashboard"'],
    ["src/app/jobs/new/page.tsx", 'backHref: "/dashboard"'],
  ];

  it.each(CASES)("%s resolves its back target away from root", (file, expected) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain(expected);
    expect(source).not.toContain('backHref="/"');
    expect(source).not.toContain('backHref: "/"');
  });

  it("finishing setup lands on the dashboard, not on root", () => {
    const actions = readFileSync("src/app/setup/actions.ts", "utf8");
    expect(actions).toContain('redirect("/dashboard")');
    expect(actions).not.toContain('redirect("/")');
  });

  it("leaves the marketing site header pointing at its own root", () => {
    // The one link to "/" that is correct: the marketing logo is a home link on
    // the marketing site, and belongs to the guest path.
    const header = readFileSync("src/app/(marketing)/_components/site-header.tsx", "utf8");
    expect(header).toContain('href="/"');
  });
});
