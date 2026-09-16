/**
 * Which build the browser is running, and how it finds out it is stale.
 *
 * The pass-9 review nearly failed its own build gate over this. The same URL
 * served two different deployments: the first two loads carried assets from
 * `dpl_4dYhre…` and behaved like the previous build, a cache-busted load
 * carried `dpl_3tBLwA…` and behaved like the new one. No service worker was
 * registered. Reading a new field twice and getting the old answer both times
 * is indistinguishable from "the deploy did not land", which is why "is the
 * deploy live?" has opened several of these reviews.
 *
 * It is worse than a testing nuisance. A contractor with Motko open in a tab
 * keeps running whatever build they loaded, indefinitely, with nothing
 * prompting a reload — so a fix shipped this morning may not reach the person
 * it was shipped for.
 *
 * Next's own mechanism for this is `deploymentId` (next.config.ts). With one
 * set, Next sends `x-deployment-id` on navigation requests and compares it with
 * the server's `x-nextjs-deployment-id` on the way back; a mismatch turns the
 * next client-side navigation into a HARD one, so the stale tab reloads itself
 * onto the current build. It also stamps `data-dpl-id` on `<html>`, which makes
 * the running build readable from the DOM — the thing the review had to infer
 * from asset URLs.
 *
 * Two honest limits, so nobody reads more into this than it does:
 *   * the reload happens on the next NAVIGATION. A tab left sitting on one
 *     page does not reload itself.
 *   * it does not change how the HTML document itself is cached.
 */

/**
 * Vercel's own identifier for the deployment, falling back to the commit it was
 * built from. Undefined off Vercel — a local `next dev` has no deployment to
 * skew against, and stamping one would only make the dev HTML differ from
 * production's for no benefit.
 *
 * `VERCEL_DEPLOYMENT_ID` is preferred because it changes on every deployment,
 * including a redeploy of the same commit. `VERCEL_GIT_COMMIT_SHA` is the
 * fallback for any environment that sets one and not the other; two deployments
 * of one commit then share an id, which is the correct answer for skew anyway —
 * the code is identical.
 */
export const resolveDeploymentId = (
  env: Record<string, string | undefined>,
): string | undefined => {
  // First NON-BLANK, not first defined: a CI step that exports the variable
  // without a value would otherwise shadow a perfectly good commit SHA with an
  // empty string, and `??` does not fall through one.
  for (const candidate of [env.VERCEL_DEPLOYMENT_ID, env.VERCEL_GIT_COMMIT_SHA]) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};
