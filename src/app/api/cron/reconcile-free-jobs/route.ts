import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileFreeJobs } from "@/lib/reconcile-free-jobs";

// Nightly reconcile of contractors.free_jobs_remaining against the credit_events
// ledger (the source of truth). Invoked by Vercel Cron; when CRON_SECRET is set,
// Vercel sends it as a Bearer token, so we reject anything that doesn't match.
export const GET = async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authorized = request.headers.get("authorization") === `Bearer ${secret}`;
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await reconcileFreeJobs(createAdminClient());
  return NextResponse.json({ ok: true, ...result });
};
