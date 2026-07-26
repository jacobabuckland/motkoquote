import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { retryFailedCollections } from "@/lib/collect-fees";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

// Daily dunning sweep. Re-attempts failed fee collections on schedule and pauses
// a trade's billing once the retry budget is spent. Invoked by Vercel Cron;
// fails closed without the Bearer CRON_SECRET.
export const GET = async (request: NextRequest) => {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  // Share the collect-fees lock: the dunning sweep re-charges mandates too, so
  // it must not run concurrently with the monthly batch.
  const locked = await acquireCronLock(admin, "collect-fees");
  if (!locked) return NextResponse.json({ ok: true, skipped: "locked" });

  try {
    const result = await retryFailedCollections(admin, {
      now: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, ...result });
  } finally {
    await releaseCronLock(admin, "collect-fees");
  }
};
