"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contractorSetupSchema } from "@/lib/schemas/contractor";

export const saveContractorSetup = async (raw: unknown) => {
  const input = contractorSetupSchema.parse(raw);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .upsert(
      {
        owner_user_id: user.id,
        company_name: input.company_name,
        company_number: input.company_number,
        trade: input.trade,
        vat_registered: input.vat_registered,
        vat_number: input.vat_number,
        day_rate: input.day_rate,
        overtime_rate: input.overtime_rate,
        callout_min: input.callout_min,
        travel_rate: input.travel_rate,
        markup_pct: input.markup_pct,
        branding: input.branding,
        business_profile: input.business_profile,
      },
      { onConflict: "owner_user_id" },
    )
    .select("id")
    .single();

  if (contractorError || !contractor) {
    throw new Error(contractorError?.message ?? "Failed to save contractor");
  }

  const contractorId = contractor.id as string;

  await supabase.from("team_members").delete().eq("contractor_id", contractorId);
  if (input.team_members.length > 0) {
    const { error } = await supabase.from("team_members").insert(
      input.team_members.map((member) => ({
        contractor_id: contractorId,
        ...member,
      })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase
    .from("merchant_accounts")
    .delete()
    .eq("contractor_id", contractorId);
  if (input.merchant_accounts.length > 0) {
    const { error } = await supabase.from("merchant_accounts").insert(
      input.merchant_accounts.map((account) => ({
        contractor_id: contractorId,
        ...account,
      })),
    );
    if (error) throw new Error(error.message);
  }

  await supabase.from("rate_cards").delete().eq("contractor_id", contractorId);
  if (input.rate_cards.length > 0) {
    const { error } = await supabase.from("rate_cards").insert(
      input.rate_cards.map((card) => ({
        contractor_id: contractorId,
        ...card,
      })),
    );
    if (error) throw new Error(error.message);
  }

  redirect("/");
};
