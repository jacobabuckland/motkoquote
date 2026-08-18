"use server";

import { createClient } from "@/lib/supabase/server";

export interface VoiceCostInput {
  contractor_id: string;
  job_id: string;
  amount_net: number;
  counterparty_id: string;
  category: string;
  vat_treatment: string;
  vat_amount: number;
  description: string;
  incurred_on: string;
  source: string;
}

export interface VoiceCostResult {
  data?: {
    id: string;
  };
  error?: string;
}

/**
 * Confirms and writes a voice-captured cost to the database.
 * Only called after user confirmation.
 */
export async function confirmVoiceCost(
  cost: VoiceCostInput
): Promise<VoiceCostResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_costs")
    .insert({
      contractor_id: cost.contractor_id,
      job_id: cost.job_id,
      amount_net: cost.amount_net,
      counterparty_id: cost.counterparty_id,
      category: cost.category,
      vat_treatment: cost.vat_treatment,
      vat_amount: cost.vat_amount,
      description: cost.description,
      incurred_on: cost.incurred_on,
      source: cost.source,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: error.message,
    };
  }

  return {
    data: {
      id: data.id,
    },
  };
}
