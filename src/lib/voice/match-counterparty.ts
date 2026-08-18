import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface Counterparty {
  id: string;
  name: string;
  kind?: string;
}

/**
 * Matches a counterparty by normalized name (case and whitespace insensitive).
 * Creates a new counterparty if no match exists.
 */
export async function matchOrCreateCounterparty(
  contractorId: string,
  name: string
): Promise<Counterparty> {
  const supabase = createSupabaseServerClient();

  // Normalize the name: trim whitespace
  const normalizedName = name.trim();

  // Try to find an existing counterparty (case-insensitive match)
  const { data: existing } = await supabase
    .from("counterparties")
    .select("id, name, kind")
    .eq("contractor_id", contractorId)
    .ilike("name", normalizedName)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      kind: existing.kind,
    };
  }

  // No match found - create a new counterparty
  const { data: created, error: createError } = await supabase
    .from("counterparties")
    .insert({
      contractor_id: contractorId,
      name: normalizedName,
      kind: "supplier", // Default for merchant names
    })
    .select("id, name, kind")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create counterparty: ${createError?.message}`);
  }

  return {
    id: created.id,
    name: created.name,
    kind: created.kind,
  };
}
