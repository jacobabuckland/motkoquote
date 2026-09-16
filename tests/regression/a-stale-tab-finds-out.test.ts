/**
 * A browser running yesterday's build finds out.
 *
 * The pass-9 review read a new field twice on a freshly created job and got the
 * old answer both times, on the same URL — assets from `dpl_4dYhre…` on the
 * first two loads, `dpl_3tBLwA…` after a cache-busting query string, no service
 * worker registered. Two reads disagreeing about what the app does is
 * indistinguishable from "the deploy did not land", and it nearly failed the
 * review's own build gate.
 *
 * The cost outside a review is larger: a contractor with Motko open keeps
 * running whatever build they loaded, with nothing prompting a reload, so a fix
 * shipped this morning need not reach the person it was shipped for.
 *
 * `deploymentId` is Next's mechanism for exactly this. What it gives us:
 *   * a mismatch between the tab's build and the server's turns the next
 *     client-side navigation into a hard one, so the tab reloads itself;
 *   * `data-dpl-id` on <html>, so the running build is READABLE rather than
 *     inferred from asset URLs — which is the part the next review can use.
 *
 * This pins the resolution, because the failure mode is silent: resolve to
 * undefined in production and nothing breaks, nothing warns, and the skew
 * protection simply is not there.
 */

import { describe, expect, it } from "vitest";
import { resolveDeploymentId } from "@/lib/deployment-id";

describe("which build the browser is running", () => {
  it("prefers the deployment, which changes on every deploy", () => {
    expect(
      resolveDeploymentId({
        VERCEL_DEPLOYMENT_ID: "dpl_3tBLwAxe4b1bVDZ3XS583ktYSXTF",
        VERCEL_GIT_COMMIT_SHA: "a7309c510248524c8f5a5f96f3f6fff700c506f6",
      }),
    ).toBe("dpl_3tBLwAxe4b1bVDZ3XS583ktYSXTF");
  });

  it("falls back to the commit where only that is set", () => {
    expect(
      resolveDeploymentId({ VERCEL_GIT_COMMIT_SHA: "a7309c510248524c8f5a5f96f3f6fff700c506f6" }),
    ).toBe("a7309c510248524c8f5a5f96f3f6fff700c506f6");
  });

  it("is undefined off Vercel, so a local dev server is unchanged", () => {
    expect(resolveDeploymentId({})).toBeUndefined();
    expect(resolveDeploymentId({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("treats an empty or blank value as absent", () => {
    // A CI step that exports the variable without a value would otherwise pin
    // every deployment to the same empty id — skew protection that silently
    // matches everything, which is worse than none because it looks present.
    expect(resolveDeploymentId({ VERCEL_DEPLOYMENT_ID: "" })).toBeUndefined();
    expect(resolveDeploymentId({ VERCEL_DEPLOYMENT_ID: "   " })).toBeUndefined();
  });

  it("falls through a blank deployment id to the commit", () => {
    expect(
      resolveDeploymentId({ VERCEL_DEPLOYMENT_ID: "", VERCEL_GIT_COMMIT_SHA: "abc123" }),
    ).toBe("abc123");
  });
});
