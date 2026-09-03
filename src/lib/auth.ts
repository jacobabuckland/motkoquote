import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/require-contractor";

/**
 * Get the current contractor for the authenticated user.
 * Returns the contractor record or null if not authenticated.
 */
export async function getCurrentContractor(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const contractor = await requireContractor<{ id: string }>(
    supabase,
    user.id,
    "id",
  );

  return contractor;
}
