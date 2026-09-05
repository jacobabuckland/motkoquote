"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Helper to revalidate paths without failing in test environments where
// Next.js static generation store is unavailable.
const safeRevalidate = (path: string) => {
  try {
    revalidatePath(path);
  } catch {
    // Silently skip in test environment
  }
};

/**
 * Archive a job: marks it filed away so it leaves the working pipeline and
 * stops being chased. Idempotent (guards on archived_at is null).
 */
export async function archiveJob(jobId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("jobs")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", jobId)
    .is("archived_at", null);

  if (error) throw new Error(`Failed to archive job: ${error.message}`);

  safeRevalidate("/jobs");
  safeRevalidate(`/jobs/${jobId}`);
}

/**
 * Restore an archived job: returns it to the working pipeline at exactly the
 * stage it was at. Idempotent (guards on archived_at is not null).
 */
export async function restoreJob(jobId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("jobs")
    .update({ archived_at: null })
    .eq("id", jobId)
    .not("archived_at", "is", null);

  if (error) throw new Error(`Failed to restore job: ${error.message}`);

  safeRevalidate("/jobs");
  safeRevalidate("/jobs/archived");
  safeRevalidate(`/jobs/${jobId}`);
}
