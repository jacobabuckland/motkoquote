import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileFreeJobs } from "@/lib/reconcile-free-jobs";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";

// Nightly reconcile of contractors.free_jobs_remaining against the credit_events
// ledger (the source of truth). Invoked by Vercel Cron; fails closed without the
// Bearer CRON_SECRET.
export const GET = async (request: NextRequest) => {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const result = await reconcileFreeJobs(createAdminClient());
  return NextResponse.json({ ok: true, ...result });
};
