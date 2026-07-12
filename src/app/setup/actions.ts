"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contractorSetupSchema, type ContractorSetupInput } from "@/lib/schemas/contractor";
import {
  businessSetupStateSchema,
  type BusinessSetupState,
} from "@/lib/schemas/business-setup";
import { BUSINESS_SETUP_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/business-setup";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { findSimilarPastJobs, syncBusinessSetupKnowledge } from "@/lib/knowledge";
import type { SupabaseClient } from "@supabase/supabase-js";

// Shared by both the manual form (saveContractorSetup) and the voice
// interview (completeSetupConversation) — a single place that writes
// contractor + team_members + merchant_accounts + rate_cards so the two
// entry points can never drift out of sync on how a setup gets persisted.
const persistContractorSetup = async (
  supabase: SupabaseClient,
  userId: string,
  input: ContractorSetupInput,
): Promise<string> => {
  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .upsert(
      {
        owner_user_id: userId,
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

  return contractorId;
};

export const saveContractorSetup = async (raw: unknown) => {
  const input = contractorSetupSchema.parse(raw);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  await persistContractorSetup(supabase, user.id, input);

  redirect("/");
};

const SETUP_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "update_business_setup",
    description:
      "Report any new or updated business setup details the contractor just gave — company name, " +
      "trade, VAT status, rates, business profile fields (used on contracts), or freeform notes " +
      "(working preferences, jobs they won't take, subcontractors they use). Only include what's new " +
      "or changed this turn, not the full running state.",
    parameters: BUSINESS_SETUP_DELTA_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "finish_setup",
    description:
      "Call this once you have at least the company name and trade, and the contractor confirms " +
      "they're done or has no more details to add.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

type SetupRealtimeSessionResult = {
  clientSecret: string;
  initialState: BusinessSetupState;
};

// Mints a Realtime session for the voice-driven "set up your business"
// interview — the same live speech-to-speech pipeline used for job intake
// (see lib/realtime.ts), pointed at a different tool/instructions pair.
// Pre-fills initialState from any existing contractor row so re-running the
// interview to update details doesn't start from a blank slate.
export const createSetupRealtimeSession = async (): Promise<SetupRealtimeSessionResult> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: existing } = await supabase
    .from("contractors")
    .select(
      "id, company_name, trade, vat_registered, vat_number, day_rate, overtime_rate, callout_min, travel_rate, markup_pct, business_profile",
    )
    .eq("owner_user_id", user.id)
    .maybeSingle();

  const initialState = businessSetupStateSchema.parse({
    company_name: existing?.company_name ?? undefined,
    trade: existing?.trade ?? undefined,
    vat_registered: existing?.vat_registered ?? null,
    vat_number: existing?.vat_number ?? undefined,
    day_rate: existing?.day_rate ?? null,
    overtime_rate: existing?.overtime_rate ?? null,
    callout_min: existing?.callout_min ?? null,
    travel_rate: existing?.travel_rate ?? null,
    markup_pct: existing?.markup_pct ?? null,
    business_profile: existing?.business_profile ?? {},
  });

  const resumeLine = existing
    ? `The contractor already has some details on file: ${JSON.stringify(initialState)}. ` +
      "Confirm what's already known briefly, then ask only about what's missing or what they want to change."
    : "";

  // Pull from the semantic knowledge layer, not just the raw contractor row —
  // this surfaces freeform notes from past setup conversations (and anything
  // else synced under this contractor_id, e.g. quote history) that never
  // made it into a structured column, so a returning contractor doesn't have
  // to repeat context they already gave.
  const knowledgeChunks = existing
    ? await findSimilarPastJobs(
        existing.id,
        "business setup rates policies preferences working notes",
      )
    : [];
  const knowledgeLine =
    knowledgeChunks.length > 0
      ? `Additional context remembered from past conversations with this contractor: ${knowledgeChunks.join(" | ")}. ` +
        "Use this as background only — don't repeat it back verbatim unless relevant. "
      : "";

  const instructions =
    "You are conducting a short spoken interview to set up a UK tradesperson's business profile on Motko, " +
    "a quoting app. Ask one question at a time, conversationally, and keep it brief. " +
    "You need at minimum: company/trading name and trade (e.g. Electrician, Plasterer). " +
    "Also useful, ask if they're happy to share: VAT registration status (and VAT number if registered), " +
    "day rate, overtime/weekend rate, minimum call-out charge, travel charge, and materials markup percentage. " +
    "Then, for contract paperwork: business structure (sole trader/limited company), registered address, " +
    "business phone/email, any trade certifications (e.g. Gas Safe number), public liability insurer and cover " +
    "amount, standard payment terms, accepted payment methods, standard workmanship guarantee period, and " +
    "governing law (default England & Wales if UK-based and they don't say). If they mention anything else " +
    "worth remembering — working preferences, jobs they won't take on, subcontractors they use — capture it " +
    "as a note via update_business_setup's notes field. " +
    "After each answer, call update_business_setup with just what they said this turn — don't repeat back the " +
    "whole state. If they don't know or don't want to give a detail, move on — nothing is mandatory except " +
    "company name and trade. Once you have at least those two and the contractor says they're done (or after " +
    "you've asked about everything above), call finish_setup. " +
    resumeLine +
    knowledgeLine;

  const clientSecret = await createRealtimeClientSecret({
    instructions,
    tools: SETUP_TOOLS,
  });

  return { clientSecret, initialState };
};

// Finalises the voice interview: validates the minimum required fields,
// maps the flat BusinessSetupState onto the same shape the manual form
// submits, and writes it via the shared persist helper.
export const completeSetupConversation = async (input: {
  state: unknown;
}): Promise<{ redirectTo: string }> => {
  const state = businessSetupStateSchema.parse(input.state);

  if (!state.company_name || !state.company_name.trim()) {
    throw new Error(
      "I didn't catch a company name — try the interview again, or fill in the form manually.",
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const setupInput = contractorSetupSchema.parse({
    company_name: state.company_name,
    trade: state.trade ?? undefined,
    vat_registered: state.vat_registered ?? false,
    vat_number: state.vat_registered ? state.vat_number ?? undefined : undefined,
    day_rate: state.day_rate ?? undefined,
    overtime_rate: state.overtime_rate ?? undefined,
    callout_min: state.callout_min ?? undefined,
    travel_rate: state.travel_rate ?? undefined,
    markup_pct: state.markup_pct ?? undefined,
    branding: {},
    business_profile: state.business_profile,
    team_members: [],
    merchant_accounts: [],
    rate_cards: [],
  });

  const contractorId = await persistContractorSetup(supabase, user.id, setupInput);

  // Best-effort — embeds the settings and any freeform notes into the
  // semantic knowledge layer so they're retrievable (via findSimilarPastJobs)
  // in future conversations, both future setup interviews and job intake.
  await syncBusinessSetupKnowledge(contractorId, state);

  return { redirectTo: "/" };
};
