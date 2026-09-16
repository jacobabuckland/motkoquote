/**
 * A QA batch can name the commit it exercised.
 *
 * Four voice-QA reports in a row carried the line "source/commit version is not
 * asserted", while `main` took several merges a day. So a batch of twenty live
 * conversations could not say which fixes it had actually run against, and the
 * attribution was done afterwards by comparing timestamps to merge times.
 *
 * That is not a tidiness problem. It is how the 16 Sep tranche came to file a
 * regression introduced that morning as a pre-existing defect: nothing in the
 * evidence tied a run to a commit, so the wrong build got the blame.
 *
 * `/api/build` returns the deployment's SHA and nothing else. It is registered
 * in PUBLIC_API_ROUTES and in tests/acceptance/99.test.ts, which is the point
 * of that registry: a human sees the unauthenticated surface.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

const read = async (): Promise<Record<string, unknown>> => {
  vi.resetModules();
  const { GET } = await import("@/app/api/build/route");
  return (await GET().json()) as Record<string, unknown>;
};

describe("what it reports", () => {
  it("names the deployed commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "8ec6d70b44cd27903037f2dce26cb657d7c3332f");

    expect(await read()).toEqual({ sha: "8ec6d70b44cd27903037f2dce26cb657d7c3332f" });
  });

  it("says so honestly when there is no deployment to name", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");

    expect(await read()).toEqual({ sha: "unknown" });
  });
});

describe("what it must not report", () => {
  it("returns the SHA and nothing else", async () => {
    // Each of branch, deploy URL, environment and author is a fact about the
    // organisation rather than the artefact, and none is needed to attribute a
    // test run. The assertion is exact so adding one is a deliberate act.
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234");

    expect(Object.keys(await read())).toEqual(["sha"]);
  });
});

describe("caching", () => {
  it("is never cached, because a stale SHA blames the wrong build", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/build/route");

    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
