import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Normalise a counterparty name for matching: lowercase and trim whitespace.
 * "Frank", "frank ", "FRANK", "  frank  " all normalise to "frank".
 */
export const normaliseCounterpartyName = (name: string): string => {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
};

/**
 * Find an existing counterparty by normalised name, or create a new one.
 * Returns the counterparty ID.
 *
 * This uses the admin client to bypass RLS for the insert, since the
 * contractor might not have permission to insert counterparties directly
 * (though the RLS policy does allow it). The read uses RLS-scoped client.
 */
export const matchOrCreateCounterparty = async (
  name: string,
  contractorId: string,
  kind: "supplier" | "subcontractor" | "other",
): Promise<string> => {
  const normalisedName = normaliseCounterpartyName(name);
  const admin = createAdminClient();

  // Search for an existing counterparty with this normalised name.
  // Case-insensitive match using LOWER() in the query.
  const { data: existing } = await admin
    .from("counterparties")
    .select("id")
    .eq("contractor_id", contractorId)
    .filter("name", "ilike", normalisedName)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  // No match found — create a new counterparty.
  const { data: newCounterparty, error } = await admin
    .from("counterparties")
    .insert({
      contractor_id: contractorId,
      name: normalisedName,
      kind,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to create counterparty: ${error.message}`);
  }

  return newCounterparty.id;
};
