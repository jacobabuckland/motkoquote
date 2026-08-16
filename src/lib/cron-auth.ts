import { NextResponse, type NextRequest } from "next/server";

// Cron endpoints move money (chase), delete data
// (purge-accounts), and message customers (chase), so they MUST fail closed. If
// CRON_SECRET is unset, or the Authorization header is missing or wrong, the
// request is rejected outright — an absent secret is a misconfiguration, never a
// reason to run an unauthenticated public job. Vercel Cron sends the secret as a
// Bearer token.
//
// Returns a 401 NextResponse to short-circuit the handler, or null when the
// caller is authorised and the handler should proceed.
export const rejectUnauthorizedCron = (request: NextRequest): NextResponse | null => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
};
