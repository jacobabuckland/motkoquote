import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Finds voice sessions stuck in sow_in_progress status for >10 minutes with
 * no completion or abandonment event, and marks them as abandoned with
 * reason "orphaned". This is the server-side safety net for sessions where
 * the client couldn't emit anything (tab closed, connection lost).
 *
 * Idempotent: skips jobs that already have a voice_session_abandoned or
 * voice_session_completed event, so running this multiple times over the
 * same orphaned session does not double-emit.
 */
export async function markOrphanedSessionsAbandoned(
  supabase: SupabaseClient,
): Promise<{ marked: number }> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // Find jobs:
  // - status = sow_in_progress (never reached completion)
  // - run_id IS NOT NULL (voice sessions; manual quotes have no run_id)
  // - created_at < 10 minutes ago (recent sessions are still running)
  const { data: candidateJobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, run_id, created_at")
    .eq("status", "sow_in_progress")
    .not("run_id", "is", null)
    .lt("created_at", tenMinutesAgo);

  if (jobsError || !candidateJobs || candidateJobs.length === 0) {
    return { marked: 0 };
  }

  const jobIds = candidateJobs.map((j) => j.id);

  // Check which of these already have a completion or abandonment event
  const { data: existingEvents, error: eventsError } = await supabase
    .from("events")
    .select("properties->job_id")
    .in(
      "properties->>job_id",
      jobIds,
    )
    .in("event_name", ["voice_session_completed", "voice_session_abandoned"]);

  if (eventsError) {
    return { marked: 0 };
  }

  const jobsWithEvents = new Set(
    (existingEvents ?? []).map((e) => (e as unknown as { job_id: string }).job_id),
  );

  // Emit voice_session_abandoned for jobs without existing events
  const toMark = candidateJobs.filter((j) => !jobsWithEvents.has(j.id));

  for (const job of toMark) {
    await supabase.from("events").insert({
      event_name: "voice_session_abandoned",
      user_id: null, // System-generated event, no user
      properties: {
        job_id: job.id,
        run_id: job.run_id,
        reason: "orphaned",
      },
    });
  }

  return { marked: toMark.length };
}
