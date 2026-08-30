import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Looks up a contractor by user ID and handles the three-outcome decision:
 * - Query error → throw (diagnosable)
 * - No row found → redirect to /setup
 * - Row found → return it
 *
 * Centralizes the error-handling defect that four pages previously had.
 */
export async function requireContractor<T = unknown>(
  client: SupabaseClient,
  userId: string,
  columns: string,
): Promise<T> {
  const { data, error } = await client
    .from("contractors")
    .select(columns)
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up contractor for user ${userId}: ${error.message}`);
  }

  if (!data) {
    redirect("/setup");
  }

  return data as T;
}
