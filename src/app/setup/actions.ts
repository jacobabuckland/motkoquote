"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { contractorSetupSchema, type ContractorSetupInput } from "@/lib/schemas/contractor";
import {
  businessSetupStateSchema,
  type BusinessSetupState,
  mergeBusinessProfile,
} from "@/lib/schemas/business-setup";
import { BUSINESS_SETUP_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/business-setup";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { findSimilarPastJobs, syncBusinessSetupKnowledge } from "@/lib/knowledge";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionNewContractor } from "@/lib/referral-signup";
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
  // Fetch existing contractor to merge business_profile
  const { data: existing } = await supabase
    .from("contractors")
    .select("business_profile")
    .eq("owner_user_id", userId)
    .maybeSingle();

  // Merge incoming business_profile with existing one to preserve fields
  // collected by other paths (form vs voice). Null or {} existing profile
  // is treated as an empty base.
  const existingProfile = existing?.business_profile ?? {};
  const mergedProfile = mergeBusinessProfile(
    existingProfile as Record<string, unknown>,
    input.business_profile,
  );

  const { data: contractor, error: contractorError } = await supabase
    .from("contractors")
    .upsert(
      {
        owner_user_id: userId,
        first_name: input.first_name,
        company_name: input.company_name,
        company_number: input.company_number,
        trade: input.trade,
        vat_registered: input.vat_registered,
        vat_number: input.vat_number,
        day_rate: input.day_rate,
        half_day_rate: input.half_day_rate,
        overtime_rate: input.overtime_rate,
        callout_min: input.callout_min,
        travel_rate: input.travel_rate,
        markup_pct: input.markup_pct,
        branding: input.branding,
        business_profile: mergedProfile,
      },
      { onConflict: "owner_user_id" },
    )
    .select("id")
    .single();

  if (contractorError || !contractor) {
    throw new Error(contractorError?.message ?? "Failed to save contractor");
  }

  const contractorId = contractor.id as string;

  // One-time referral provisioning: the +5 signup grant, redemption of any code
  // captured at signup (stashed in user_metadata.referral_code), and issuing the
  // trade's own shareable code. Idempotent, so running on every autosave is
  // harmless. Best-effort — a hiccup here must never block saving the business.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const signupReferralCode =
      typeof user?.user_metadata?.referral_code === "string"
        ? user.user_metadata.referral_code
        : null;
    await provisionNewContractor(createAdminClient(), {
      contractorId,
      refereeEmail: user?.email ?? null,
      signupReferralCode,
    });
  } catch (error) {
    console.warn("[referral] provisioning failed", error);
  }

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
  await supabase.auth.updateUser({ data: { setup_incomplete: false } });

  // Setup completion lands on the dashboard (see CLAUDE.md, UI conventions).
  // "/" reached it only via the root route's signed-in redirect.
  redirect("/dashboard");
};

// Background autosave for the manual setup form: persists the whole form via
// the same validated helper as the explicit Save, but does NOT redirect and
// does NOT flip the setup_incomplete flag — so a contractor can never lose a
// section's work by navigating away mid-edit. The bottom "Save details" button
// remains the explicit finish action (which redirects). Company name is
// required at the DB level, so the caller only fires this once it's present.
export const autosaveContractorSetup = async (raw: unknown) => {
  const input = contractorSetupSchema.parse(raw);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  await persistContractorSetup(supabase, user.id, input);
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
    name: "record_person",
    description:
      "Call once per person when the contractor tells you someone works with them — a lad, apprentice, " +
      "or subbie — AND they've given that person's day rate. Ask their name, what they do, and what they " +
      "pay them a day, then call this so the person is saved to the team and available for pricing future " +
      "quotes. Don't call it for 'just me' or if they won't give a rate.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's name, e.g. 'Ben'." },
        role: {
          type: "string",
          description: "What they do, e.g. 'Labourer', 'Apprentice', 'Electrician'.",
        },
        day_rate: { type: "number", description: "Their day rate in GBP." },
      },
      required: ["name", "day_rate"],
    },
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
      "id, first_name, company_name, trade, vat_registered, vat_number, day_rate, half_day_rate, overtime_rate, callout_min, travel_rate, markup_pct, business_profile",
    )
    .eq("owner_user_id", user.id)
    .maybeSingle();

  // Pre-fill any team already on file so a resuming contractor's crew isn't
  // wiped: completeSetupConversation persists state.team_members verbatim, and
  // persistContractorSetup deletes-then-reinserts, so an empty list here would
  // silently drop existing members. Loading them means the interview can also
  // skip re-asking about people it already knows.
  const existingTeam = existing
    ? (
        await supabase
          .from("team_members")
          .select("name, role, day_rate")
          .eq("contractor_id", existing.id)
      ).data ?? []
    : [];

  const initialState = businessSetupStateSchema.parse({
    first_name: existing?.first_name ?? undefined,
    company_name: existing?.company_name ?? undefined,
    trade: existing?.trade ?? undefined,
    vat_registered: existing?.vat_registered ?? null,
    vat_number: existing?.vat_number ?? undefined,
    day_rate: existing?.day_rate ?? null,
    half_day_rate: existing?.half_day_rate ?? null,
    overtime_rate: existing?.overtime_rate ?? null,
    callout_min: existing?.callout_min ?? null,
    travel_rate: existing?.travel_rate ?? null,
    markup_pct: existing?.markup_pct ?? null,
    business_profile: existing?.business_profile ?? {},
    team_members: existingTeam,
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

  // Motko speaks first the instant the call connects (the client fires a
  // response.create on data-channel open). If we already know their name, open
  // by it; otherwise the very first thing to do is ask for it, then confirm it
  // warmly and record it via update_business_setup's first_name. Only greet by
  // name at the opening and the wrap-up — not on every turn.
  const openingLine = existing?.first_name
    ? `You already know the contractor's first name is "${existing.first_name}". Open the moment the ` +
      `call connects by greeting them by name — e.g. "Hi ${existing.first_name}, it's Motko — let's get ` +
      `your business set up, takes a couple of minutes." Then move into the first real question. `
    : `Open the conversation yourself the moment the call connects — the contractor hasn't spoken yet. ` +
      `Say exactly this, in your own natural voice: "Hi, I'm Motko. I'll get your business set up — takes ` +
      `a couple of minutes. First off, what's your name?" When they answer, confirm it warmly using it ` +
      `(e.g. "Nice one, Reece —") and call update_business_setup with first_name set to their first name. ` +
      `Use their first name in this greeting and again at the wrap-up, but not in every turn. `;

  // A required slot after rates: does anyone work with them? This is what makes
  // team-based pricing work for anyone who isn't a sole operator. Loop naturally
  // per person (name, role, day rate), record_person each, repeat-back the rate
  // (money-relevant number). "Just me" is a complete answer — move on, no fuss.
  // Cap at 6; beyond that, defer to Settings. If a team's already on file,
  // acknowledge them rather than re-interrogating.
  const teamLine =
    existingTeam.length > 0
      ? `You already have their team on file: ${existingTeam
          .map((m) => `${m.name}${m.role ? ` (${m.role})` : ""}`)
          .join(", ")}. Don't re-ask about these people — only ask if anyone new has joined, and if so ` +
        `capture each new person with record_person (name, role, day rate), confirming the rate by repeating it back. `
      : "After rates, you must ask whether anyone works with them: 'Does anyone work with you — any lads, " +
        "apprentices, subbies?'. If it's just them, that's a complete answer — say something like 'No worries, " +
        "just you then' and move straight on. If yes, go through them one at a time: get each person's name, " +
        "what they do (labourer, apprentice, electrician...), and what they pay them a day — e.g. 'Who's first? " +
        "… What's Ben, a labourer? And what do you pay him a day?'. Confirm each day rate by repeating it back " +
        "(e.g. 'a hundred and twenty a day, yeah?'), then call record_person with their name, role and day_rate. " +
        "Stop after six people — if they have more, say 'I'll get the first few — you can add the rest in " +
        "Settings later' and move on. ";

  const instructions =
    "You are conducting a short spoken interview to set up a UK tradesperson's business profile on Motko, " +
    "a quoting app. Ask one question at a time, conversationally, and keep it brief. " +
    "Always speak and transcribe in English (UK) — never switch to another language even if a word, name, " +
    "or accent sounds foreign; UK trade names and places often do. " +
    openingLine +
    "You need at minimum: company/trading name and trade (e.g. Electrician, Plasterer). " +
    // The day rate is the anchor every later quote is priced from. Without one
    // the drafting compiler has no rate to resolve a labour line against, so
    // the line comes out unpriced and the trade's first quote is a screen of
    // TBCs — which is what a first-run account looked like before this. So it
    // is asked plainly rather than offered as one of a list of optional extras,
    // and the half day with it, because a great many trade jobs are half a day.
    "Their day rate matters more than anything else on this list — ask for it directly (\'What do you " +
    "charge for a day?\'), and then whether they do half days and what they charge for one. Take " +
    "\'I don\'t do half days\' as a complete answer and move on. " +
    "Also useful, ask if they're happy to share: VAT registration status (and VAT number if registered), " +
    "overtime/weekend rate, minimum call-out charge, travel charge, and materials markup percentage. " +
    teamLine +
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
    "Proper nouns are easy to mishear over the phone. The first time you capture a detail that's spelling-" +
    "sensitive — the registered address, business email, or a certification number — repeat it back once to " +
    "confirm (e.g. 'gassafe dot co, that's g-a-s-s-a-f-e — have I got that right?') and only that once. If " +
    "they correct you, ask them to spell the tricky part and update it. Don't repeat-back everything or turn " +
    "it into a spelling test; a single quick check per detail. " +
    resumeLine +
    knowledgeLine;

  const clientSecret = await createRealtimeClientSecret({
    instructions,
    tools: SETUP_TOOLS,
  });

  return { clientSecret, initialState };
};

// Outcome of the voice interview's finalisation. A discriminated result
// rather than throw-on-failure: server actions have their thrown Error
// messages stripped in production (replaced with the generic "An error
// occurred in the server components render"), so any friendly message we
// threw would reach the tradesperson as that cryptic string. Returning the
// message means the interview can end gracefully with plain English.
type CompleteSetupResult =
  | { ok: true; redirectTo: string }
  | { ok: false; message: string };

// Finalises the voice interview: validates the minimum required fields,
// maps the flat BusinessSetupState onto the same shape the manual form
// submits, and writes it via the shared persist helper. Never throws for an
// expected failure — returns a friendly message the caller can show, so the
// session finishes gracefully instead of surfacing a masked server error.
export const completeSetupConversation = async (input: {
  state: unknown;
}): Promise<CompleteSetupResult> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, message: "Your session timed out — sign in and try again." };
  }

  let state: BusinessSetupState;
  try {
    state = businessSetupStateSchema.parse(input.state);
  } catch {
    return {
      ok: false,
      message:
        "I couldn't make sense of what we captured — try the interview again, or fill in the form manually.",
    };
  }

  if (!state.company_name || !state.company_name.trim()) {
    // Didn't hit the minimum bar to save a contractor row (company_name is
    // required at the DB level). Flag the account so the app knows to route
    // them straight back to the voice interview next time, instead of the
    // generic /setup landing screen, rather than silently losing the fact
    // that they already tried.
    await supabase.auth.updateUser({ data: { setup_incomplete: true } });
    return {
      ok: false,
      message:
        "I didn't catch a company name — try the interview again, or fill in the form manually.",
    };
  }

  // The spoken interview captures numbers loosely (businessSetupStateSchema
  // leaves markup and rates unbounded), but the contractor schema bounds
  // markup to 0–100 and rates to non-negative. A mis-heard or out-of-range
  // figure would otherwise fail the parse and abort the whole save — so drop
  // any out-of-range optional number rather than lose everything else the
  // contractor gave. company_name and trade are the only real requirements.
  const nonNegative = (n: number | null): number | undefined =>
    n != null && n >= 0 ? n : undefined;
  const markupPct =
    state.markup_pct != null && state.markup_pct >= 0 && state.markup_pct <= 100
      ? state.markup_pct
      : undefined;

  let contractorId: string;
  try {
    const setupInput = contractorSetupSchema.parse({
      first_name: state.first_name ?? undefined,
      company_name: state.company_name,
      trade: state.trade ?? undefined,
      vat_registered: state.vat_registered ?? false,
      vat_number: state.vat_registered ? state.vat_number ?? undefined : undefined,
      day_rate: nonNegative(state.day_rate),
      half_day_rate: nonNegative(state.half_day_rate),
      overtime_rate: nonNegative(state.overtime_rate),
      callout_min: nonNegative(state.callout_min),
      travel_rate: nonNegative(state.travel_rate),
      markup_pct: markupPct,
      branding: {},
      business_profile: state.business_profile,
      team_members: state.team_members,
      merchant_accounts: [],
      rate_cards: [],
    });

    contractorId = await persistContractorSetup(supabase, user.id, setupInput);

    // Clear the incomplete flag now that a contractor row actually exists.
    await supabase.auth.updateUser({ data: { setup_incomplete: false } });

    // Best-effort — embeds the settings and any freeform notes into the
    // semantic knowledge layer so they're retrievable (via findSimilarPastJobs)
    // in future conversations, both future setup interviews and job intake.
    await syncBusinessSetupKnowledge(contractorId, state);
  } catch (error) {
    console.error("[setup] completeSetupConversation failed to save", error);
    return {
      ok: false,
      message:
        "Something went wrong saving your details just now — try again in a moment, or fill in the form manually.",
    };
  }

  return { ok: true, redirectTo: "/" };
};
