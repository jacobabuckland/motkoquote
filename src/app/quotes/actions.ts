"use server";

import { createClient } from "@/lib/supabase/server";
import { throwIfQueryFailed } from "@/lib/query-error";
import type { LineItem } from "@/lib/schemas/job";

type QuoteData = {
  id: string;
  job_id: string;
  drafted_line_items_json: LineItem[] | null;
  line_items_json: LineItem[];
  contractor_flags_json: string[];
};

/**
 * Get quote data for a specific job.
 * Returns null if no quote exists for the job.
 */
export async function getQuote(jobId: string): Promise<QuoteData | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("quotes")
    .select("id, job_id, drafted_line_items_json, line_items_json, contractor_flags_json")
    .eq("job_id", jobId)
    .maybeSingle();

  await throwIfQueryFailed(error, "quote lookup");

  if (!data) return null;

  return {
    id: data.id,
    job_id: data.job_id,
    drafted_line_items_json: (data.drafted_line_items_json as LineItem[] | null) ?? null,
    line_items_json: (data.line_items_json as LineItem[]) ?? [],
    contractor_flags_json: (data.contractor_flags_json as string[]) ?? [],
  };
}
