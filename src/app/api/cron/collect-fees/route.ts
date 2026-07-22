import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runFeeCollectionBatch } from "@/lib/collect-fees";

// Monthly fee-collection batch. Runs on the 1st: rolls every accrued job into
// one commercial-VRP charge per trade and pulls it into motko's merchant
// account. Invoked by Vercel Cron; when CRON_SECRET is set, Vercel sends it as a
// Bearer token, so anything that doesn't match is rejected.
export const GET = async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authorized = request.headers.get("authorization") === `Bearer ${secret}`;
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
  // Label the collection with the calendar month that just ended.
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const periodStart = new Date(
    Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1),
  );
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  const result = await runFeeCollectionBatch(createAdminClient(), {
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
    now: now.toISOString(),
  });

  return NextResponse.json({ ok: true, ...result });
};
