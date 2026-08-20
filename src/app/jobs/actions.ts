"use server";

import { createClient } from "@/lib/supabase/server";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import {
  ACCOUNT_REALTIME_TOOLS,
  BASE_REALTIME_TOOLS,
  buildJobIntakeInstructions,
} from "@/lib/voice/job-intake-prompt";
import { generateSowNarrative, draftQuoteLineItems } from "@/lib/claude";
import { computeQuoteTotals } from "@/lib/quote-math";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { customerInputSchema } from "@/lib/schemas/customer";
import {
  sowToExtraction,
  mergeSowToolDelta,
  summarizeRequiredSlotCoverage,
  EMPTY_SOW_STATE,
  resolvePricingMode,
  pricingModeSchema,
  type SowState,
  type ChecklistQuestionId,
} from "@/lib/schemas/sow";
import { applyPricingMode } from "@/lib/pricing-mode";
import { sendQuoteEmail } from "@/lib/email";
import { sendQuoteSms } from "@/lib/sms";
import { normalizeUkPhone } from "@/lib/phone";
import { withTimeout, TIMEOUT_MS } from "@/lib/with-timeout";
import { findSimilarPastJobs, syncQuoteKnowledge } from "@/lib/knowledge";
import { findKnownMaterialPrices, rememberMaterialPrices } from "@/lib/materials";
import { compileDraftToLineItems, hasUnresolvedRateFlag } from "@/lib/compile-draft";
import { applyAgreedDayRate, applyAgreedFixedPrice } from "@/lib/agreed-costs";
import { usedGenericFallback } from "@/lib/question-packs/fallback";
import { diffLineItems, getContractorTendencies, recordQuoteEdits } from "@/lib/quote-learning";
import { track, logError } from "@/lib/analytics";
import { transcriptTurnsSchema } from "@/lib/voice-transcript";
import {
  ZERO_TOTAL_CONFIRM_REQUIRED,
  EDITABLE_STATUSES,
  isEditableQuoteStatus,
  QUOTE_NOT_EDITABLE,
} from "@/lib/quote-send-guards";
import { z } from "zod";

// The conversation's instructions and tool set now live in
// @/lib/voice/job-intake-prompt, shared with the unauthenticated guest intake
// so the must-ask pricing-slot invariant cannot drift between the two.
const REALTIME_TOOLS: RealtimeToolDef[] = [
  ...BASE_REALTIME_TOOLS,
  ...ACCOUNT_REALTIME_TOOLS,
];

export type RealtimeSessionResult = {
  jobId: string;
  clientSecret: string;
};

// Starts a new SoW job and mints a Realtime session personalised to the
// contractor. Trade-defaulting and recent-job context are baked into the
// system instructions once, up front — the whole conversation now happens
// live over one continuous WebRTC connection instead of turn-by-turn
// record → transcribe → LLM → synthesize server round trips.
export const createRealtimeSession = async (): Promise<RealtimeSessionResult> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, trade, first_name")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  // Queries the same semantic knowledge layer that setup interviews and past
  // quotes write into — match_knowledge_chunks doesn't filter by source, so
  // this can surface past job summaries, remembered rates/policies from
  // setup, or freeform setup notes, whichever's most relevant to this trade.
  const contractorKnowledge = contractor.trade
    ? await findSimilarPastJobs(contractor.id, contractor.trade)
    : [];

  const { data: newJob, error } = await supabase
    .from("jobs")
    .insert({ contractor_id: contractor.id, status: "sow_in_progress" })
    .select("id")
    .single();
  if (error || !newJob) throw new Error(error?.message ?? "Failed to create job");

  const instructions = buildJobIntakeInstructions({
    firstName: contractor.first_name,
    trade: contractor.trade,
    knowledge: contractorKnowledge,
    includeAccountTools: true,
  });

  const clientSecret = await createRealtimeClientSecret({ instructions, tools: REALTIME_TOOLS });

  return { jobId: newJob.id, clientSecret };
};

// Typed-quote fallback for when the voice intake can't run (microphone denied,
// in use, or no hardware). Creates an empty draft job + quote so the
// contractor lands straight in the quote editor and builds the whole thing by
// hand — no LLM, no microphone. Mirrors the shape completeSowConversation
// leaves behind (a job with a draft quote) so the job hub renders identically.
export const createManualJob = async (): Promise<{ jobId: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  const { data: newJob, error: jobError } = await supabase
    .from("jobs")
    .insert({ contractor_id: contractor.id, status: "drafted" })
    .select("id")
    .single();
  if (jobError || !newJob) throw new Error(jobError?.message ?? "Failed to create job");

  const { error: quoteError } = await supabase.from("quotes").insert({
    job_id: newJob.id,
    line_items_json: [],
    drafted_line_items_json: [],
    total: 0,
    status: "draft",
  });
  if (quoteError) throw new Error(quoteError.message ?? "Failed to create quote");

  return { jobId: newJob.id };
};

// Persists the contractor's own first name, captured mid-call by the
// record_first_name tool when it wasn't already known. Best-effort from the
// client's perspective — a failure here must never interrupt the live call.
const saveContractorFirstNameSchema = z.object({
  firstName: z.string().min(1).max(80),
});

export const saveContractorFirstName = async (
  input: z.infer<typeof saveContractorFirstNameSchema>,
): Promise<void> => {
  const { firstName } = saveContractorFirstNameSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await supabase
    .from("contractors")
    .update({ first_name: firstName })
    .eq("owner_user_id", user.id);
};

// Persists a person the contractor named mid-call (via record_person) as a
// real team_members row, so pricing can reference them by their confirmed day
// rate — both in this same quote (completeSowConversation re-reads
// team_members at draft time) and on every future job. Best-effort from the
// client's perspective: a failure here must never interrupt the live call.
const recordTeamMemberSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().max(80).optional(),
  day_rate: z.number().nonnegative(),
});

export const recordTeamMember = async (
  input: z.infer<typeof recordTeamMemberSchema>,
): Promise<void> => {
  const { name, role, day_rate } = recordTeamMemberSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  await supabase.from("team_members").insert({
    contractor_id: contractor.id,
    name,
    role: role ?? null,
    day_rate,
  });

  await track("team_member_recorded", { method: "voice" });
};

const saveSowDeltaSchema = z.object({
  jobId: z.string().uuid(),
  delta: z.unknown(),
});

// Called from the client each time the Realtime model invokes the
// update_sow tool over the WebRTC data channel. Deterministic merge only —
// the model never writes SowState directly, it only reports deltas.
export const saveSowDelta = async (
  input: z.infer<typeof saveSowDeltaSchema>,
): Promise<{ sowState: SowState }> => {
  const { jobId, delta } = saveSowDeltaSchema.parse(input);
  const supabase = await createClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("sow_json")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error(error?.message ?? "Job not found");

  const sowState = mergeSowToolDelta(job.sow_json as SowState | null, delta);

  await supabase.from("jobs").update({ sow_json: sowState }).eq("id", jobId);

  return { sowState };
};

const completeSowSchema = z.object({
  jobId: z.string().uuid(),
  transcript: z.string().optional(),
  // Speaker-labelled turns for the same call, persisted into conversation_json.
  // Optional so the manual/typed fallbacks that never run a live call don't
  // have to supply it.
  conversationTurns: transcriptTurnsSchema.optional(),
  // How the live intake concluded, for the voice_session_completed event —
  // see WrapReason. Optional so the manual/typed fallbacks that don't run a
  // live call don't have to fabricate one.
  wrapReason: z
    .enum(["slots", "user", "cap_questions", "cap_time", "manual"])
    .optional(),
  questionsAsked: z.number().int().nonnegative().optional(),
  // Which required slots (crew/duration/materials_supply) the client actually
  // put to the contractor during the call — used to log slot coverage
  // alongside voice_session_completed. Optional, so the manual/typed
  // fallbacks that never run a live call don't have to supply it.
  requiredSlotsAsked: z
    .array(z.enum(["crew", "duration", "materials_supply", "deadline", "agreed_costs"]))
    .optional(),
  // Fix 4 — required slots the live call ended without ever asking (channel
  // gone before the wrap detour, or the detour timed out unanswered). Persisted
  // onto sow_json as the wrap_incomplete flag so the job page can surface a "tap
  // to answer" prompt. Optional; the manual/typed fallbacks never run a live
  // call and so never leave a slot unasked.
  unaskedRequired: z
    .array(z.enum(["crew", "duration", "materials_supply", "deadline", "agreed_costs"]))
    .optional(),
});

// Runs once the live conversation ends — either the model called finish_job,
// or the client hit the turn cap. Drafts the quote from whatever SoW state
// was accumulated via saveSowDelta during the call, same as the old
// end-of-conversation branch did. Does not redirect — the client tears down
// the WebRTC connection first, then navigates using the returned jobId.
export const completeSowConversation = async (
  input: z.infer<typeof completeSowSchema>,
): Promise<{ jobId: string }> => {
  const {
    jobId,
    transcript,
    conversationTurns,
    wrapReason,
    questionsAsked,
    requiredSlotsAsked,
    unaskedRequired,
  } = completeSowSchema.parse(input);
  // Start of the post-call pipeline (extraction → lookups → LLM draft → price).
  // Logged as pipeline_ms on voice_session_completed so p50/p95 of the "wrap to
  // editor-ready" gap is visible in the events data — the dominant cost the
  // contractor waits on after the call wraps.
  const startedAt = Date.now();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select(
      "id, company_name, trade, vat_registered, day_rate, overtime_rate, callout_min, travel_rate, markup_pct",
    )
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, sow_json")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .single();
  if (jobError || !job) throw new Error(jobError?.message ?? "Job not found");

  let sowState: SowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  // Fix 4 — a call that ended without ever asking a required slot is flagged on
  // the SoW so the job page can prompt "tap to answer" rather than presenting a
  // complete-looking quote built on a slot the contractor was never asked.
  const unaskedRequiredSlots = unaskedRequired ?? [];
  sowState = {
    ...sowState,
    complete: true,
    next_question: undefined,
    used_generic_fallback: usedGenericFallback(sowState.job_type),
    wrap_incomplete: unaskedRequiredSlots.length > 0,
    unasked_required: unaskedRequiredSlots,
  };

  const preNarrativeExtraction = sowToExtraction(sowState);

  // These lookups don't depend on each other — run them together rather
  // than serially, since each is its own network round-trip.
  const [
    { data: teamMembers },
    { data: rateCards },
    similarPastJobs,
    knownMaterialPrices,
    overviewNarrative,
    contractorTendencies,
  ] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, name, role, day_rate")
      .eq("contractor_id", contractor.id),
    supabase
      .from("rate_cards")
      .select("id, work_type, unit, rate_per_unit, complexity_notes")
      .eq("contractor_id", contractor.id),
    findSimilarPastJobs(
      contractor.id,
      `${preNarrativeExtraction.job_type} ${preNarrativeExtraction.scope_items.join(" ")}`,
    ),
    findKnownMaterialPrices(contractor.id, preNarrativeExtraction.materials_mentioned),
    generateSowNarrative(sowState, {
      trade: contractor.trade,
      companyName: contractor.company_name,
    }),
    getContractorTendencies(contractor.id),
  ]);

  sowState = { ...sowState, overview_narrative: overviewNarrative };
  const extraction = sowToExtraction(sowState);

  await supabase
    .from("jobs")
    .update({
      sow_json: sowState,
      extracted_json: extraction,
      transcript: transcript ?? null,
      // Speaker-labelled turns alongside the flat transcript string above. Only
      // written when the call supplied them; left untouched otherwise so a
      // re-draft without turns doesn't wipe the labelled record.
      ...(conversationTurns ? { conversation_json: conversationTurns } : {}),
      status: "extracted",
    })
    .eq("id", job.id);

  const draft = await draftQuoteLineItems(extraction, {
    trade: contractor.trade,
    day_rate: contractor.day_rate,
    overtime_rate: contractor.overtime_rate,
    callout_min: contractor.callout_min,
    travel_rate: contractor.travel_rate,
    markup_pct: contractor.markup_pct,
    team_members: teamMembers ?? [],
    similar_past_jobs: similarPastJobs,
    known_material_prices: knownMaterialPrices,
    rate_cards: rateCards ?? [],
    contractor_tendencies: contractorTendencies,
  });

  // The pricing contract: the LLM proposed structure only, code computes
  // every amount. compileDraftToLineItems prices labour from the contractor's
  // day/overtime/team rates, rate-card lines from the referenced card,
  // materials with the markup (customer-supplied at £0), and provisional sums
  // from their editable suggestion. Any place the model's guess couldn't be
  // honoured surfaces as a mismatch for monitoring, never a silent wrong price.
  const { lineItems: compiledItems, mismatches, contractorFlags } = compileDraftToLineItems(
    draft.line_items,
    {
      day_rate: contractor.day_rate,
      overtime_rate: contractor.overtime_rate,
      markup_pct: contractor.markup_pct,
      team_members: teamMembers ?? [],
      rate_cards: rateCards ?? [],
      known_material_prices: knownMaterialPrices,
      owner_label: "Owner",
    },
    draft.contractor_flags,
  );

  for (const mismatch of mismatches) {
    await track("pricing_mismatch", {
      kind: mismatch.kind,
      reason: mismatch.reason,
      description: mismatch.description,
      llm_value: mismatch.llm_value,
      computed_value: mismatch.computed_value,
    });
  }

  // Deterministic override — if the contractor already agreed a day rate
  // or fixed price with the customer before this quote (checklist question
  // 5), that figure is honoured exactly, taking precedence over the computed
  // rates. Day rate first (affects only labour lines), then fixed price
  // (reconciles the whole quote) — if both were somehow agreed, the fixed
  // price is what the customer expects to see as the total, so it wins.
  const dayRatedItems = applyAgreedDayRate(compiledItems, sowState.agreed_costs?.day_rate);
  const calculatedLineItems = applyAgreedFixedPrice(dayRatedItems, sowState.agreed_costs?.fixed_price);

  // Pricing mode (Task B): in "fixed" mode the active quote collapses to a
  // single works line at the contractor's stated total plus provisional sums;
  // "days"/"calculated" keep the full breakdown. The calculated breakdown is
  // always stored as drafted_line_items_json so the editor can switch back out
  // of fixed mode without re-invoking the LLM.
  const lineItems = applyPricingMode(calculatedLineItems, sowState);

  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      job_id: job.id,
      line_items_json: lineItems,
      // Immutable baseline for the learning loop (see quote-learning.ts) and
      // the retained calculated breakdown for pricing-mode switches — this is
      // the full computed structure, distinct from line_items_json which holds
      // the active view (collapsed in fixed mode) and mutates on save.
      drafted_line_items_json: calculatedLineItems,
      // Editor-only prompts — never rendered on a customer document.
      contractor_flags_json: contractorFlags,
      total,
      status: "draft",
    })
    .select("id")
    .single();

  if (quoteError || !quote) throw new Error(quoteError?.message ?? "Failed to create quote");

  await track("quote_created", { method: "voice" });

  await supabase.from("jobs").update({ status: "drafted" }).eq("id", job.id);

  await syncQuoteKnowledge({
    contractorId: contractor.id,
    quoteId: quote.id,
    jobType: extraction.job_type,
    scopeItems: extraction.scope_items,
    // Learn from the full calculated breakdown even in fixed mode — the
    // collapsed single works line carries no material/rate detail to learn.
    lineItems: calculatedLineItems,
  });

  // Loop-regression telemetry (Task 3): a healthy live intake concludes on
  // 'slots'/'user'/'manual'; a spike in 'cap_questions'/'cap_time' means the
  // model is failing to wrap up on its own and the hard safety net is ending
  // the call instead. Carries required-slot coverage (Task D) and pipeline_ms
  // — the full wrap→editor-ready drafting duration — so a stall or latency
  // creep in the post-call gap is visible in the data. Logged here at the end
  // (not on entry) so pipeline_ms reflects the whole pipeline; a failing draft
  // is captured separately by reportVoicePipelineFailure. Only when the caller
  // ran a live call.
  if (wrapReason) {
    const coverage = summarizeRequiredSlotCoverage(
      sowState,
      (requiredSlotsAsked as ChecklistQuestionId[] | undefined) ?? [],
    );
    await track("voice_session_completed", {
      wrap_reason: wrapReason,
      questions_asked: questionsAsked ?? null,
      required_slots_asked: coverage.asked,
      required_slots_answered: coverage.answered,
      required_slots_unknown: coverage.unknown,
      // null when pricing.mode was never set — meaningful data (the mode
      // question didn't land) so we track it explicitly rather than defaulting.
      pricing_mode: resolvePricingMode(sowState),
      pipeline_ms: Date.now() - startedAt,
      // Fix 4 — whether the call ended with required slots never asked, and
      // which. wrap_incomplete distinguishes a clean wrap from the silent
      // escape hatch (channel gone / detour timed out) in the telemetry.
      wrap_incomplete: unaskedRequiredSlots.length > 0,
      unasked_required: unaskedRequiredSlots,
    });
  }

  return { jobId: job.id };
};

const redraftJobSchema = z.object({ jobId: z.string().uuid() });

// Re-runs pricing for a job whose stored draft came back with zero line items
// (the empty-draft error state in the editor). Reuses the same draft → compile
// path as the live-call completion, from the SoW already persisted, and
// overwrites the existing quote's line items. Kept deliberately narrow — it
// re-prices, it does not re-open the conversation or touch knowledge sync.
export const redraftJob = async (
  input: z.infer<typeof redraftJobSchema>,
): Promise<{ lineItemCount: number }> => {
  const { jobId } = redraftJobSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, trade, vat_registered, day_rate, overtime_rate, callout_min, travel_rate, markup_pct")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, sow_json")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .single();
  if (!job) throw new Error("Job not found");

  // Same rule as updateQuoteLineItems: a redraft rewrites line_items_json and
  // total, so it may only run while the quote is still editable. Checked HERE,
  // before draftQuoteLineItems is invoked, so a refused redraft costs no
  // tokens. The UPDATE below asserts the status again for the race.
  const { data: existingQuote } = await supabase
    .from("quotes")
    .select("status")
    .eq("job_id", jobId)
    .maybeSingle();
  if (existingQuote && !isEditableQuoteStatus(existingQuote.status as string)) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  const sowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  const extraction = sowToExtraction(sowState);

  const [{ data: teamMembers }, { data: rateCards }, similarPastJobs, knownMaterialPrices, contractorTendencies] =
    await Promise.all([
      supabase.from("team_members").select("id, name, role, day_rate").eq("contractor_id", contractor.id),
      supabase
        .from("rate_cards")
        .select("id, work_type, unit, rate_per_unit, complexity_notes")
        .eq("contractor_id", contractor.id),
      findSimilarPastJobs(contractor.id, `${extraction.job_type} ${extraction.scope_items.join(" ")}`),
      findKnownMaterialPrices(contractor.id, extraction.materials_mentioned),
      getContractorTendencies(contractor.id),
    ]);

  const draft = await draftQuoteLineItems(extraction, {
    trade: contractor.trade,
    day_rate: contractor.day_rate,
    overtime_rate: contractor.overtime_rate,
    callout_min: contractor.callout_min,
    travel_rate: contractor.travel_rate,
    markup_pct: contractor.markup_pct,
    team_members: teamMembers ?? [],
    similar_past_jobs: similarPastJobs,
    known_material_prices: knownMaterialPrices,
    rate_cards: rateCards ?? [],
    contractor_tendencies: contractorTendencies,
  });

  const { lineItems: compiledItems, contractorFlags } = compileDraftToLineItems(
    draft.line_items,
    {
      day_rate: contractor.day_rate,
      overtime_rate: contractor.overtime_rate,
      markup_pct: contractor.markup_pct,
      team_members: teamMembers ?? [],
      rate_cards: rateCards ?? [],
      known_material_prices: knownMaterialPrices,
      owner_label: "Owner",
    },
    draft.contractor_flags,
  );

  const dayRatedItems = applyAgreedDayRate(compiledItems, sowState.agreed_costs?.day_rate);
  const calculatedLineItems = applyAgreedFixedPrice(dayRatedItems, sowState.agreed_costs?.fixed_price);
  // Same pricing-mode branch as completeSowConversation — keep the calculated
  // breakdown as the drafted baseline, collapse to the fixed works line for the
  // active view when in fixed mode.
  const lineItems = applyPricingMode(calculatedLineItems, sowState);
  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  // Assert the editable prior state in the UPDATE too, so an acceptance that
  // lands while the draft was being generated can't be overwritten. Zero rows
  // means the status moved under us — refuse rather than report success.
  const { data: redrafted, error: redraftError } = await supabase
    .from("quotes")
    .update({
      line_items_json: lineItems,
      drafted_line_items_json: calculatedLineItems,
      contractor_flags_json: contractorFlags,
      total,
    })
    .eq("job_id", jobId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id");

  if (redraftError) throw new Error(redraftError.message);
  if (!redrafted || redrafted.length === 0) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  return { lineItemCount: lineItems.length };
};

// Switches the pricing mode of an existing quote from the editor (Task B),
// recomputing the active line items without re-invoking the LLM. Fixed mode
// collapses to the single works line at the given amount plus provisional
// sums; itemised (days/calculated) rebuilds from the retained calculated
// breakdown in drafted_line_items_json. Persists the new mode onto the job's
// sow_json so a later redraft/reload stays consistent, updates line_items_json
// + total, and returns the recomputed lines for the editor to render.
const setQuotePricingModeSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
  mode: pricingModeSchema,
  // Required for fixed mode — the stated net total. When omitted for a switch
  // TO fixed, the calculated net subtotal is used as the starting figure.
  fixedAmount: z.number().positive().nullable().default(null),
});

export const setQuotePricingMode = async (
  input: z.infer<typeof setQuotePricingModeSchema>,
): Promise<{ lineItems: LineItem[]; total: number }> => {
  const { jobId, quoteId, mode, fixedAmount } = setQuotePricingModeSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, vat_registered")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, sow_json")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .single();
  if (!job) throw new Error("Job not found");

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, status, line_items_json, drafted_line_items_json")
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .single();
  if (!quote) throw new Error("Quote not found");

  // Same rule as updateQuoteLineItems: switching mode rewrites
  // line_items_json and total, so it may only run while the quote is still
  // editable. The UPDATE below asserts the status again for the race.
  if (!isEditableQuoteStatus(quote.status as string)) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  const sowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  // The calculated breakdown is the source for every mode — fall back to the
  // current active lines for legacy quotes with no stored drafted baseline.
  const calculatedLineItems =
    (quote.drafted_line_items_json as LineItem[] | null) ??
    (quote.line_items_json as LineItem[] | null) ??
    [];

  // For a switch to fixed with no explicit figure, seed from the calculated
  // net subtotal so the contractor starts from a sensible number to adjust.
  const resolvedFixedAmount =
    mode === "fixed"
      ? fixedAmount ??
        computeQuoteTotals(calculatedLineItems, contractor.vat_registered).subtotal
      : null;

  const nextSow: SowState = {
    ...sowState,
    pricing: { mode, fixed_amount: resolvedFixedAmount },
  };

  const lineItems = applyPricingMode(calculatedLineItems, nextSow);
  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  // Order matters: the guarded quote UPDATE runs FIRST. These are two separate
  // statements with no transaction, so writing sow_json first would leave the
  // job's pricing mode switched while the quote kept its old figures whenever
  // the guard refuses — a partial write that is worse than either outcome.
  const { data: repriced, error: repriceError } = await supabase
    .from("quotes")
    .update({ line_items_json: lineItems, total })
    .eq("id", quote.id)
    .in("status", [...EDITABLE_STATUSES])
    .select("id");

  if (repriceError) throw new Error(repriceError.message);
  if (!repriced || repriced.length === 0) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  await supabase.from("jobs").update({ sow_json: nextSow }).eq("id", job.id);

  return { lineItems, total };
};

// Records that a stored draft came back with zero priced line items — an error
// state the editor surfaces rather than an empty page. Emitted from the editor
// when it mounts with no line items.
const reportEmptyDraftSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
});

export const reportEmptyQuoteDraft = async (
  input: z.infer<typeof reportEmptyDraftSchema>,
): Promise<void> => {
  const { jobId, quoteId } = reportEmptyDraftSchema.parse(input);
  await logError("server", "Quote draft produced zero line items", { jobId, quoteId });
  await track("quote_draft_empty", { jobId, quoteId });
};

// Persists the live-call transcript against the job without drafting — the
// "Save and finish later" escape hatch from the staged progress screen, used
// when the write-up/pricing pipeline stalls or fails. Keeps the conversation
// so the contractor can pick it up later rather than losing everything.
const saveVoiceTranscriptSchema = z.object({
  jobId: z.string().uuid(),
  transcript: z.string(),
  conversationTurns: transcriptTurnsSchema.optional(),
});

export const saveVoiceTranscript = async (
  input: z.infer<typeof saveVoiceTranscriptSchema>,
): Promise<void> => {
  const { jobId, transcript, conversationTurns } =
    saveVoiceTranscriptSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  await supabase
    .from("jobs")
    .update({
      transcript,
      ...(conversationTurns ? { conversation_json: conversationTurns } : {}),
    })
    .eq("id", jobId)
    .eq("contractor_id", contractor.id);

  await track("voice_saved_for_later", { jobId });
};

// Records a stall or failure in the voice→quote pipeline (write-up or pricing
// stage), tagged with which stage the UI was showing when it broke. Emitted
// from the staged progress screen on timeout or error.
const reportVoicePipelineFailureSchema = z.object({
  jobId: z.string().uuid(),
  stage: z.enum(["writing", "pricing"]),
  message: z.string(),
});

export const reportVoicePipelineFailure = async (
  input: z.infer<typeof reportVoicePipelineFailureSchema>,
): Promise<void> => {
  const { jobId, stage, message } = reportVoicePipelineFailureSchema.parse(input);
  await logError("server", "Voice pipeline stage failed", { jobId, stage, message });
  await track("voice_pipeline_stage_failed", { jobId, stage, message });
};

const updateQuoteSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
  lineItems: z.array(lineItemSchema),
});

export const updateQuoteLineItems = async (
  input: z.infer<typeof updateQuoteSchema>,
) => {
  const { quoteId, lineItems } = updateQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: quoteContext } = await supabase
    .from("quotes")
    .select(
      "status, job:jobs(extracted_json, contractor:contractors(id, vat_registered))",
    )
    .eq("id", quoteId)
    .single();

  const context = quoteContext as unknown as {
    status: string;
    job: {
      extracted_json: { job_type?: string; scope_items?: string[] } | null;
      contractor: { id: string; vat_registered: boolean };
    };
  } | null;
  const job = context?.job;

  // A quote is only editable while it is still being prepared or is out for a
  // decision ('draft' | 'sent'). Once the customer has accepted or declined,
  // the figures are agreed evidence — editing them would silently change the
  // price behind a signed/accepted quote. Refuse rather than rewrite history.
  // The vocabulary lives in quote-send-guards so redraftJob and
  // setQuotePricingMode assert the identical rule (they write the same columns).
  if (context && !isEditableQuoteStatus(context.status)) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  const vatRegistered = Boolean(job?.contractor?.vat_registered);

  const { total } = computeQuoteTotals(lineItems as LineItem[], vatRegistered);

  // Assert the editable prior state in the UPDATE too, so a concurrent
  // acceptance that lands between the read and the write can't be overwritten.
  const { data: updated, error } = await supabase
    .from("quotes")
    .update({ line_items_json: lineItems, total })
    .eq("id", quoteId)
    .in("status", [...EDITABLE_STATUSES])
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    throw new Error(QUOTE_NOT_EDITABLE);
  }

  if (job?.contractor?.id) {
    await syncQuoteKnowledge({
      contractorId: job.contractor.id,
      quoteId,
      jobType: job.extracted_json?.job_type,
      scopeItems: job.extracted_json?.scope_items,
      lineItems: lineItems as LineItem[],
    });
    await rememberMaterialPrices(job.contractor.id, lineItems as LineItem[]);
  }

  return { total };
};

const sendQuoteSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
  customer: customerInputSchema,
  // Set by the client after the contractor confirms a deliberate £0 total.
  confirmZeroTotal: z.boolean().default(false),
  // Which channels to attempt — defaults to "whatever contact info is
  // present" so existing callers (and the email-only original flow) keep
  // working without passing this explicitly.
  channels: z
    .object({ email: z.boolean().default(true), sms: z.boolean().default(true) })
    .default({ email: true, sms: true }),
});

// z.input, not z.infer: `channels` and `confirmZeroTotal` both carry defaults,
// so callers may omit them. Using the output type would make every default a
// required argument at the call site.
export const sendQuote = async (input: z.input<typeof sendQuoteSchema>) => {
  const { jobId, quoteId, customer, channels, confirmZeroTotal } =
    sendQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("contractor_id, customer_id, sow_json, contractor:contractors(company_name)")
    .eq("id", jobId)
    .single();

  if (!job) throw new Error("Job not found");

  // No fee gate here, deliberately. Sending a quote was once blocked once the
  // free allowance and a grace window were spent, unblocking only on an
  // authorised VRP mandate — a rail PAY-5 removed, which made the unblock
  // condition unreachable and left the gate able to strand a trade permanently.
  // The fee is taken out of each payment at source, so there is nothing to set
  // up and no reason to stop anyone quoting. The runway is informational only
  // (see the dashboard banner).

  const { data: quote } = await supabase
    .from("quotes")
    .select("total, line_items_json, drafted_line_items_json, contractor_flags_json")
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  // Two different situations, deliberately not merged.
  //
  // A line the compiler could not price is a MISSING figure: the quote is
  // incomplete and the contractor can fix it in seconds by entering a rate, so
  // this blocks and says which. It guards on the flag, not on the amount —
  // an unpriced line among priced ones produces a perfectly non-zero total.
  if (hasUnresolvedRateFlag(quote.contractor_flags_json as string[] | null)) {
    throw new Error(
      "This quote isn't priced: no day rate was found, so the labour has no figure. " +
        "Add your day rate in Business details, or price the line yourself, then send.",
    );
  }

  // A zero total with no such flag is a DELIBERATE figure — a goodwill callout,
  // a warranty visit. Confirm it, never block it.
  if (Number(quote.total) === 0 && !confirmZeroTotal) {
    throw new Error(ZERO_TOTAL_CONFIRM_REQUIRED);
  }

  // Learning loop: this is the moment of truth — what the contractor is
  // actually sending vs what was first drafted for them. Recorded once here
  // (not on every intermediate "Save changes") so it reflects their real,
  // final correction rather than in-progress keystrokes. Skipped in fixed
  // pricing mode: line_items_json is the collapsed single works line while
  // drafted_line_items_json is the full calculated breakdown, so a diff would
  // be pure noise (the contractor never saw or edited the breakdown). Mode null
  // (legacy jobs / mode never set) is treated as non-fixed, so the diff runs.
  if (
    quote.drafted_line_items_json &&
    resolvePricingMode((job.sow_json as SowState | null) ?? { pricing: null }) !== "fixed"
  ) {
    const edits = diffLineItems(
      quote.drafted_line_items_json as LineItem[],
      quote.line_items_json as LineItem[],
    );
    await recordQuoteEdits(job.contractor_id, quoteId, edits);
  }

  const normalizedPhone = customer.phone ? normalizeUkPhone(customer.phone) : null;

  const customerContact = {
    email: customer.email,
    phone: normalizedPhone ?? customer.phone,
    address: customer.address,
    sms_opt_out: customer.smsOptOut,
  };

  // Idempotency guard: a re-send or a double-tapped send must not pile up
  // duplicate customer rows. If this job already has a customer, update it
  // in place rather than inserting a fresh one each time.
  if (job.customer_id) {
    const { error: customerUpdateError } = await supabase
      .from("customers")
      .update({ name: customer.name, contact: customerContact })
      .eq("id", job.customer_id);
    if (customerUpdateError) throw new Error(customerUpdateError.message);
  } else {
    const { data: customerRow, error: customerError } = await supabase
      .from("customers")
      .insert({
        contractor_id: job.contractor_id,
        name: customer.name,
        contact: customerContact,
      })
      .select("id")
      .single();

    if (customerError || !customerRow) {
      throw new Error(customerError?.message ?? "Failed to save customer");
    }

    await supabase
      .from("jobs")
      .update({ customer_id: customerRow.id })
      .eq("id", jobId);
  }

  const companyName = (
    job.contractor as unknown as { company_name: string } | null
  )?.company_name ?? "Your contractor";

  const quoteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/q/${quoteId}`;

  // Each channel is only attempted if the contractor selected it, the
  // relevant contact detail is present, and (for SMS) the customer hasn't
  // opted out. Independent of each other — a missing/failed email should
  // never block SMS delivery, and vice versa.
  const emailAttempted = channels.email && Boolean(customer.email);
  const smsAttempted = channels.sms && Boolean(normalizedPhone) && !customer.smsOptOut;

  // Flip the quote to "sent" exactly once, the moment the first channel
  // confirms delivery, so the contractor's job board reflects it without
  // waiting on the slower channel. Guarded synchronously (no await before the
  // flag is set) so two near-simultaneous deliveries can't double-write.
  let statusFlipped = false;
  const markSent = async () => {
    if (statusFlipped) return;
    statusFlipped = true;
    await supabase
      .from("quotes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", quoteId);
  };

  // Each channel is bounded by withTimeout so a hanging Resend/Twilio call can
  // never wedge the send — the action always resolves inside the client's
  // "always resolve" budget. A timeout or error resolves the channel as
  // not-delivered and is logged, never thrown.
  const sendEmail = async (): Promise<{ delivered: boolean }> => {
    if (!emailAttempted) return { delivered: false };
    try {
      const result = await withTimeout(
        sendQuoteEmail({
          to: customer.email!,
          customerName: customer.name,
          companyName,
          quoteUrl,
          total: quote.total,
        }),
        TIMEOUT_MS.email,
        "sendQuoteEmail",
      );
      if (result.delivered) await markSent();
      return result;
    } catch (err) {
      await logError("server", "sendQuote email failed", {
        quote_id: quoteId,
        detail: err instanceof Error ? err.message : String(err),
      });
      return { delivered: false };
    }
  };

  const sendSms = async (): Promise<{ delivered: boolean }> => {
    if (!smsAttempted) return { delivered: false };
    try {
      const result = await withTimeout(
        sendQuoteSms({
          to: normalizedPhone!,
          companyName,
          total: quote.total,
          quoteUrl,
        }),
        TIMEOUT_MS.sms,
        "sendQuoteSms",
      );
      if (result.delivered) await markSent();
      return result;
    } catch (err) {
      await logError("server", "sendQuote sms failed", {
        quote_id: quoteId,
        detail: err instanceof Error ? err.message : String(err),
      });
      return { delivered: false };
    }
  };

  const [emailResult, smsResult] = await Promise.all([sendEmail(), sendSms()]);

  // Even when no channel delivered, the quote still flips to "sent": the
  // contractor falls back to copying the /q/ link. markSent is idempotent, so
  // if a channel already flipped it on first success this is a no-op.
  await markSent();

  await track("quote_sent", { quote_id: quoteId });

  return {
    delivered: emailResult.delivered || smsResult.delivered,
    email: { attempted: emailAttempted, delivered: emailResult.delivered },
    sms: { attempted: smsAttempted, delivered: smsResult.delivered },
    quoteUrl,
  };
};
