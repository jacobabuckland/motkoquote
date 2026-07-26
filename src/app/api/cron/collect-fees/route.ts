import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeeCollectionBatch } from "@/lib/collect-fees";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";

// Monthly fee-collection batch. Runs on the 1st: rolls every accrued job into
// one commercial-VRP charge per trade and pulls it into motko's merchant
// account. Invoked by Vercel Cron; fails closed without the Bearer CRON_SECRET.
export const GET = async (request: NextRequest) => {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  const admin = createAdminClient();
  // Run lock: if an overlapping run holds it, no-op. Double-charge is already
  // impossible via the fee_collections unique index; this just avoids redundant
  // work when Vercel Cron delivers more than once.
  const locked = await acquireCronLock(admin, "collect-fees");
  if (!locked) return NextResponse.json({ ok: true, skipped: "locked" });

  try {
    const now = new Date();
    // Label the collection with the calendar month that just ended.
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const periodStart = new Date(
      Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1),
    );
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);

    const result = await runFeeCollectionBatch(admin, {
      periodStart: isoDate(periodStart),
      periodEnd: isoDate(periodEnd),
      now: now.toISOString(),
    });

    return NextResponse.json({ ok: true, ...result });
  } finally {
    await releaseCronLock(admin, "collect-fees");
  }
};
