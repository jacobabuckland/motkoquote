import { NextResponse } from "next/server";

// The Sentry tunnel (OBS-5), written by hand rather than generated.
//
// WHY NOT `tunnelRoute` IN next.config.ts, which is the documented way:
// because that route is created by the build plugin and never exists as a file
// under `src/app/api/`. `tests/acceptance/99.test.ts` inventories public routes
// by walking that directory, so a generated tunnel is a live unauthenticated
// endpoint the registry cannot see — and its stale-detector would reject a
// hand-added entry precisely because no file backs it.
//
// AGENTS.md: "Never resolve a registry failure by moving the thing being
// registered out of its view; a route that stops being seen is worse than one
// that fails the check." A generated route was never in view at all. Writing it
// here puts it in the inventory, and lets this file say exactly what it
// forwards instead of trusting a plugin's defaults.
//
// WHY A TUNNEL EXISTS AT ALL: ad blockers block ingest.sentry.io directly, so
// without one a share of users report nothing and the dashboard looks calm
// while it is not. Silent under-reporting is the failure mode OBS-5 exists to
// prevent, so the fix cannot itself be silently lossy.
//
// Approved by Jacob on 4 Sep 2026 as a public route, registered in
// PUBLIC_API_ROUTES and in tests/acceptance/99.test.ts.

/**
 * The DSN this app is allowed to forward to, parsed once.
 *
 * Returning null when the DSN is absent or malformed means the route refuses
 * everything rather than forwarding somewhere unintended. Local development
 * and any fork have no DSN, and there the tunnel should be inert, not lenient.
 */
const allowedTarget = (): { host: string; projectId: string } | null => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!projectId) return null;
    return { host: url.host, projectId };
  } catch {
    return null;
  }
};

export const POST = async (request: Request): Promise<NextResponse> => {
  const target = allowedTarget();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.text();

  // A Sentry envelope is newline-delimited JSON whose FIRST line is the header,
  // and the header carries the DSN the client thinks it is reporting to. That
  // is the whole access control here: forward only envelopes addressed to this
  // project. Without this check the route is an open relay to any Sentry
  // account, which is a materially different exposure from "someone can burn
  // our own quota".
  const header = body.split("\n", 1)[0] ?? "";
  let envelopeDsn: string | undefined;
  try {
    envelopeDsn = (JSON.parse(header) as { dsn?: string }).dsn;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!envelopeDsn) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  let host: string;
  let projectId: string;
  try {
    const parsed = new URL(envelopeDsn);
    host = parsed.host;
    projectId = parsed.pathname.replace(/^\//, "");
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (host !== target.host || projectId !== target.projectId) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const upstream = await fetch(`https://${target.host}/api/${target.projectId}/envelope/`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-sentry-envelope" },
  });

  // The browser SDK does not act on the response body, and echoing an upstream
  // error back would tell an unauthenticated caller about our Sentry account.
  return new NextResponse(null, { status: upstream.ok ? 200 : 502 });
};
