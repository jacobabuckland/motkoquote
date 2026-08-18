import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface MatchedJob {
  id: string;
  contractor_id: string;
  customer_id: string | null;
  status: string;
}

/**
 * Matches jobs by customer name (case-insensitive).
 * Returns all matching jobs for the given contractor.
 */
export async function matchJobByCustomerName(
  contractorId: string,
  customerName: string
): Promise<MatchedJob[]> {
  const supabase = createSupabaseServerClient();

  // First, find customers with matching names (case-insensitive, partial match)
  const { data: customers, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("contractor_id", contractorId)
    .ilike("name", `%${customerName}%`);

  if (customerError || !customers || customers.length === 0) {
    return [];
  }

  const customerIds = customers.map((c) => c.id);

  // Find all jobs for these customers
  const { data: jobs, error: jobError } = await supabase
    .from("jobs")
    .select("id, contractor_id, customer_id, status")
    .eq("contractor_id", contractorId)
    .in("customer_id", customerIds)
    .neq("status", "archived"); // Exclude archived jobs

  if (jobError || !jobs) {
    return [];
  }

  return jobs as MatchedJob[];
}
