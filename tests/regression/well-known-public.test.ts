// Regression: the platform association files must be reachable without a
// session, and must be reachable by being REGISTERED as public rather than by
// being hidden from the proxy.
//
// Apple requires /.well-known/apple-app-site-association to be served over
// HTTPS at exactly that path with no redirect, and its fetcher
// (app-site-association.cdn-apple.com) carries no cookies. The path was absent
// from isPublicRoute and absent from the proxy matcher's exclusions, so an
// unauthenticated fetch got a 307 to /login. The domain association was
// therefore never established and NO universal link worked on any path —
// including /i/*/paid, which areas/motko.md records as a deep link the app
// must own, and which had been quietly landing paying customers on the web
// page for as long as the file has existed.
//
// The second half of this file is the part that is easy to lose: there are two
// ways to stop the 307, and only one of them is correct. Excluding the path in
// src/proxy.ts also works, and removes the path from the middleware's view
// entirely — so the next person reading the public-route list cannot see that
// this surface is public. The matcher must keep matching.
import { describe, expect, it, vi } from "vitest";
import { updateSession } from "@/lib/supabase/middleware";
import { config as proxyConfig } from "@/proxy";
import type { NextRequest } from "next/server";

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

// Built through a real URL so the pathname is normalised exactly as it is in
// production before the proxy ever sees it. Writing the pathname in by hand
// would let a test assert against a path the runtime can never produce.
const requestFor = (pathname: string): NextRequest => {
  const url = new URL(pathname, "https://motko.app");
  return {
    nextUrl: {
      pathname: url.pathname,
      clone: () => new URL(url),
    },
    url: url.href,
    cookies: { getAll: () => [], set: () => {} },
    headers: new Headers(),
  } as unknown as NextRequest;
};

const redirectTargetFor = async (pathname: string): Promise<string | null> => {
  const response = await updateSession(requestFor(pathname));
  return response.headers.get("location");
};

describe("platform association files are reachable unauthenticated", () => {
  it("serves the AASA file without redirecting", async () => {
    expect(await redirectTargetFor("/.well-known/apple-app-site-association")).toBeNull();
  });

  it("serves assetlinks.json without redirecting", async () => {
    // No Android build exists today. The path is bound anyway so that adding
    // one cannot silently reintroduce this defect on the Android side.
    expect(await redirectTargetFor("/.well-known/assetlinks.json")).toBeNull();
  });
});

describe("the public surface is not widened past /.well-known/", () => {
  it.each([
    "/settings",
    "/dashboard",
    "/jobs/abc123",
    // Nested under an authenticated route, so it must NOT inherit the prefix.
    "/dashboard/.well-known/apple-app-site-association",
    // Normalises to /dashboard before the proxy sees it.
    "/.well-known/../dashboard",
  ])("still redirects %s to /login", async (pathname) => {
    expect(await redirectTargetFor(pathname)).toBe("https://motko.app/login");
  });

  it("leaves the routes that were already public alone", async () => {
    expect(await redirectTargetFor("/i/abc123/paid")).toBeNull();
    expect(await redirectTargetFor("/auth/confirm")).toBeNull();
    expect(await redirectTargetFor("/start")).toBeNull();
  });
});

describe("the fix is registration, not concealment", () => {
  it("keeps the proxy matching /.well-known/, so the public list stays authoritative", () => {
    const matchers = Array.isArray(proxyConfig.matcher)
      ? proxyConfig.matcher
      : [proxyConfig.matcher];

    const matchesSomeMatcher = (pathname: string) =>
      matchers.some((source) => new RegExp(`^${source}$`).test(pathname));

    // If this fails, someone stopped the 307 by excluding the path in
    // src/proxy.ts instead of registering it in isPublicRoute. The redirect
    // goes away either way; the visibility of the public surface does not.
    expect(matchesSomeMatcher("/.well-known/apple-app-site-association")).toBe(true);
    expect(matchesSomeMatcher("/.well-known/assetlinks.json")).toBe(true);
  });
});
