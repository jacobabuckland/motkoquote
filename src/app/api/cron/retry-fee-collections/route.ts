import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryFailedCollections } from "@/lib/collect-fees";

// Daily dunning sweep. Re-attempts failed fee collections on schedule and pauses
// a trade's billing once the retry budget is spent. Invoked by Vercel Cron; when
// CRON_SECRET is set, Vercel sends it as a Bearer token, so anything that
// doesn't match is rejected.
export const GET = async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authorized = request.headers.get("authorization") === `Bearer ${secret}`;
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await retryFailedCollections(createAdminClient(), {
    now: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, ...result });
};
