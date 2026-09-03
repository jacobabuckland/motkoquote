import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { markOrphanedSessionsAbandoned } from "@/lib/voice-abandonment";

/**
 * Cron endpoint that finds voice sessions stuck in sow_in_progress for >10
 * minutes with no completion event and marks them abandoned. Invoked by
 * Vercel Cron (e.g., every 15 minutes).
 *
 * Authorization: Bearer token in Authorization header must match CRON_SECRET.
 */
export async function GET(request: Request) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const result = await markOrphanedSessionsAbandoned(supabase);

  return NextResponse.json({ marked: result.marked }, { status: 200 });
}
