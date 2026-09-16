import { NextResponse } from "next/server";

/**
 * Which build is live. Unauthenticated, and deliberately so.
 *
 * Four QA reports in a row have carried the line "source/commit version is not
 * asserted", and `main` takes several merges a day — so a batch of 20 live
 * conversations could not say which fixes it had actually exercised, and the
 * attribution was done afterwards by comparing timestamps. That is how the
 * 16 Sep tranche came to classify a regression of mine as a pre-existing
 * defect: nothing in the evidence tied a run to a commit.
 *
 * WHAT IT DISCLOSES, and why that is acceptable: the commit SHA of the running
 * deployment, and nothing else. The repository is private, so the SHA names a
 * commit an outsider cannot read; it is also already on every page of the app,
 * because Next writes a build id into the HTML. This adds a stable, parseable
 * place to read it rather than a new fact.
 *
 * WHAT IT MUST NOT BECOME: a place to add the branch, the deploy URL, the
 * environment, or anything about who deployed it. Each of those is a fact about
 * the organisation rather than about the artefact, and none is needed to
 * attribute a test run.
 *
 * Registered in PUBLIC_API_ROUTES and in tests/acceptance/99.test.ts, which is
 * the point of that registry firing — a human sees the unauthenticated surface.
 */
export const GET = () => {
  // Vercel sets this at build time. Absent locally, and blank on a deployment
  // that was built without git metadata -- `??` falls through neither, so test
  // both. "unknown" is the honest answer to each: no deployment to name.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim();

  return NextResponse.json(
    {
      sha: sha && sha.length > 0 ? sha : "unknown",
    },
    // Never cached. A stale SHA is worse than no SHA — it would attribute a run
    // to the wrong build, which is the exact failure this exists to end.
    { headers: { "cache-control": "no-store" } },
  );
};
