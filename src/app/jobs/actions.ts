"use server";

import { revalidatePath } from "next/cache";
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
// Whether the rendered quote will carry a scope section decides the wording of
// the fixed-mode works line, so the persisted description matches the document
// it will appear on.
import { buildQuoteScope } from "@/lib/pdf/quote-payload";
import { notifyCustomer } from "@/lib/notify-customer";
import { normalizeUkPhone } from "@/lib/phone";
import { findSimilarPastJobs, syncQuoteKnowledge } from "@/lib/knowledge";
import { findKnownMaterialPrices, rememberMaterialPrices } from "@/lib/materials";
import { compileDraftToLineItems, hasUnresolvedRateFlag } from "@/lib/compile-draft";
import { withStatedPriceFlag } from "@/lib/stated-price-guard";
import { applyAgreedDayRate, applyAgreedFixedPrice } from "@/lib/agreed-costs";
import { usedGenericFallback } from "@/lib/question-packs/fallback";
import { diffLineItems, getContractorTendencies, recordQuoteEdits } from "@/lib/quote-learning";
import { track, logError } from "@/lib/analytics";
import { transcriptTurnsSchema } from "@/lib/voice-transcript";
import { assessDraftDeletion, type DeletionCandidate } from "@/lib/draft-delete-guard";
import { findTeamMemberByName, type TeamMember } from "@/lib/team-roster";
import {
  ZERO_TOTAL_CONFIRM_REQUIRED,
  narrativeConfirmMessage,
  narrativeExceedsSubtotal,
  agreedPriceDisagrees,
  EDITABLE_STATUSES,
  isEditableQuoteStatus,
  QUOTE_NOT_EDITABLE,
} from "@/lib/quote-send-guards";
import { withCustomerDetailsFlag } from "@/lib/customer-details-guard";
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

  // No knowledge retrieval here, deliberately — do not reinstate it.
  //
  // This used to call findSimilarPastJobs(contractor.id, contractor.trade) and
  // inject the result into the live intake prompt. At session start the job
  // does not exist, so the only available query text is the bare trade name
  // ("Electrician") — which ranks that contractor's chunks close to
  // arbitrarily — and match_knowledge_chunks applies no similarity floor, so
  // three chunks came back unconditionally once three existed. Each chunk is a
  // complete past quote including its priced line items, untruncated. The
  // result was an intake prompt pre-loaded with three unrelated jobs before the
  // contractor had spoken: the agent reproduced their line items, treated
  // required slots as already answered, and skipped the questions it exists to
  // ask. The pool grows with every completed quote and every quote edit, so the
  // contamination worsened over time with no deploy to point at.
  //
  // Retrieval still happens where a real scope exists to key it on — see the
  // drafting call below, which queries on job_type plus scope_items.

  // The saved crew, so the agent knows who it already knows. Read alongside
  // the job insert rather than after it — this is on the path to the first
  // spoken word, and the two don't depend on each other.
  //
  // This is NOT the retrieval that was removed above, and must not become it:
  // it is the contractor's own Settings data, a handful of names with a role
  // and a day rate. No past job, no priced line item, nothing for the agent to
  // mistake for an answer it has already been given.
  const [{ data: newJob, error }, { data: savedTeam }] = await Promise.all([
    supabase
      .from("jobs")
      .insert({ contractor_id: contractor.id, status: "sow_in_progress" })
      .select("id")
      .single(),
    supabase
      .from("team_members")
      .select("name, role, day_rate")
      .eq("contractor_id", contractor.id),
  ]);
  if (error || !newJob) throw new Error(error?.message ?? "Failed to create job");

  const instructions = buildJobIntakeInstructions({
    firstName: contractor.first_name,
    trade: contractor.trade,
    includeAccountTools: true,
    teamMembers: (savedTeam ?? []) as unknown as TeamMember[],
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

  // Someone already on the team is UPDATED, never inserted again. The agent
  // works from a name it heard down a phone line, so the same person can be
  // reported mid-call as a new one — a saved "Liam" came back a second time and
  // the team ended up holding him twice, which then offers the drafting model
  // two ids for one person. The name match is the deduplication; the prompt now
  // also carries the saved roster so it has something to check against first.
  const { data: roster } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("contractor_id", contractor.id);

  const existing = findTeamMemberByName(
    (roster ?? []) as unknown as { id: string; name: string }[],
    name,
  );

  if (existing) {
    // Last value wins on role and rate: if the contractor is telling us again,
    // what they say now is the correction. The saved spelling of the name is
    // left alone — Settings is where a name is edited, not a phone call.
    await supabase
      .from("team_members")
      .update({ role: role ?? null, day_rate })
      .eq("id", existing.id);
  } else {
    await supabase.from("team_members").insert({
      contractor_id: contractor.id,
      name,
      role: role ?? null,
      day_rate,
    });
  }

  await track("team_member_recorded", { method: "voice", updated: Boolean(existing) });
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
  const lineItems = applyPricingMode(
    calculatedLineItems,
    sowState,
    Boolean(buildQuoteScope(sowState, calculatedLineItems)),
  );

  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  // The stated price must survive to the document. If it did not, the
  // contractor is told which two figures disagree rather than being handed a
  // complete-looking quote at a price nobody chose. See stated-price-guard.
  const flagsWithPriceCheck = withStatedPriceFlag(contractorFlags, sowState, lineItems);

  // A call that ends without a name or a contact channel must be VISIBLE, not
  // silently handed over as a complete-looking quote. The send already blocks
  // on both, so this does not add a gate — it moves the discovery from the
  // moment the contractor tries to send to the moment they open the quote.
  // See customer-details-guard for why this flags rather than forces a
  // question (#373).
  const flagsWithCustomerCheck = withCustomerDetailsFlag(flagsWithPriceCheck, sowState);

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
      contractor_flags_json: flagsWithCustomerCheck,
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
  const lineItems = applyPricingMode(
    calculatedLineItems,
    sowState,
    Boolean(buildQuoteScope(sowState, calculatedLineItems)),
  );
  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  // Assert the editable prior state in the UPDATE too, so an acceptance that
  // lands while the draft was being generated can't be overwritten. Zero rows
  // means the status moved under us — refuse rather than report success.
  const { data: redrafted, error: redraftError } = await supabase
    .from("quotes")
    .update({
      line_items_json: lineItems,
      drafted_line_items_json: calculatedLineItems,
      contractor_flags_json: withCustomerDetailsFlag(
        withStatedPriceFlag(contractorFlags, sowState, lineItems),
        sowState,
      ),
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
    .select("id, status, line_items_json, drafted_line_items_json, contractor_flags_json")
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

  const lineItems = applyPricingMode(
    calculatedLineItems,
    nextSow,
    Boolean(buildQuoteScope(nextSow, calculatedLineItems)),
  );
  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  // Order matters: the guarded quote UPDATE runs FIRST. These are two separate
  // statements with no transaction, so writing sow_json first would leave the
  // job's pricing mode switched while the quote kept its old figures whenever
  // the guard refuses — a partial write that is worse than either outcome.
  // Seeding a fixed amount from the calculated subtotal produces figures that
  // agree, so this normally clears the flag rather than raising it — which is
  // exactly why it runs here too. A mismatch left standing after the contractor
  // fixed it trains them to ignore the flag.
  const { data: repriced, error: repriceError } = await supabase
    .from("quotes")
    .update({
      line_items_json: lineItems,
      total,
      contractor_flags_json: withStatedPriceFlag(
        quote.contractor_flags_json as string[] | null,
        nextSow,
        lineItems,
      ),
    })
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
      "status, contractor_flags_json, job:jobs(extracted_json, sow_json, contractor:contractors(id, vat_registered))",
    )
    .eq("id", quoteId)
    .single();

  const context = quoteContext as unknown as {
    status: string;
    contractor_flags_json: string[] | null;
    job: {
      extracted_json: { job_type?: string; scope_items?: string[] } | null;
      sow_json: SowState | null;
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
  // This writer is how the production divergence happened: it wrote
  // line_items_json and total with NO view of sow_json at all, so editing a
  // fixed-mode works line left pricing.fixed_amount stranded at the old figure
  // — permanently, and with nothing comparing the two. It now reconciles like
  // every other writer of these columns.
  const { data: updated, error } = await supabase
    .from("quotes")
    .update({
      line_items_json: lineItems,
      total,
      contractor_flags_json: withStatedPriceFlag(
        context?.contractor_flags_json,
        job?.sow_json,
        lineItems as LineItem[],
      ),
    })
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
  // Set by the client after the contractor confirms that the scope narrative's
  // figure and the priced total are meant to differ.
  confirmNarrativeMismatch: z.boolean().default(false),
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
  const {
    jobId,
    quoteId,
    customer,
    channels,
    confirmZeroTotal,
    confirmNarrativeMismatch,
  } = sendQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("contractor_id, customer_id, sow_json, contractor:contractors(company_name, vat_registered)")
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

  // The document must not contradict itself. Quote 45E0DB69 went out with a
  // scope narrative reading "at a fixed price of £5,000" above a single priced
  // line of £5.00 — two figures for the same job, three orders of magnitude
  // apart, on one page the customer signs against.
  //
  // Compared against the NET subtotal computed from the line items, not
  // `quotes.total`: the narrative states a net figure and the total may carry
  // VAT, so comparing against the total would fire on every VAT-registered
  // quote that names its price in prose. There is no subtotal column, so it is
  // recomputed here from the same line items the customer is shown.
  //
  // Like the £0 confirmation this asks rather than refuses — a narrative may
  // legitimately name a figure the total does not equal.
  if (!confirmNarrativeMismatch) {
    const sow = (job.sow_json as SowState | null) ?? null;
    const netSubtotal = computeQuoteTotals(
      (quote.line_items_json as LineItem[]) ?? [],
      false,
    ).subtotal;
    const narrative = narrativeExceedsSubtotal(
      sow?.overview_narrative,
      netSubtotal,
    );
    const fieldsDisagree = agreedPriceDisagrees(
      sow?.agreed_costs?.fixed_price,
      sow?.pricing?.fixed_amount,
    );
    if (narrative.confirmRequired || fieldsDisagree) {
      throw new Error(
        narrativeConfirmMessage(narrative.statedAmount, netSubtotal),
      );
    }
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
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        // Freeze what the customer was actually told. This is the SAME
        // quote.total handed to notifyCustomer above — deliberately not a
        // re-read, because a second read could observe a different value than
        // the one that went into the SMS body, and this column's only job is to
        // record what was delivered (#370).
        sent_total: quote.total,
      })
      .eq("id", quoteId);
  };

  // Through the shared dispatcher, which owns channel eligibility, phone
  // normalisation, per-channel timeouts and per-channel error logging. It does
  // NOT own the status transition: markSent stays here because whether a quote
  // flips to "sent" is this action's business, not the dispatcher's.
  const report = await notifyCustomer({
    event: "quote_sent",
    customer: {
      name: customer.name,
      email: customer.email,
      phone: normalizedPhone ?? undefined,
      smsOptOut: customer.smsOptOut === true,
    },
    companyName,
    url: quoteUrl,
    amount: quote.total,
    // quotes.total is VAT-inclusive; the message says so when it is.
    // vat_registered must be in the select above or this is silently always
    // false — a label behind a value that can never be true is the same shape
    // of defect as #369, and a unit test of the formatter would not catch it.
    vatRegistered: Boolean(
      (job.contractor as unknown as { vat_registered?: boolean } | null)?.vat_registered,
    ),
    channels,
  });

  const emailResult = report.email;
  const smsResult = report.sms;
  const emailAttempted = report.email.attempted;
  const smsAttempted = report.sms.attempted;

  // The quote flips to "sent" whether or not a channel delivered: the
  // contractor falls back to copying the /q/ link, and a spent form must not
  // linger. markSent is idempotent.
  await markSent();

  await track("quote_sent", { quote_id: quoteId });

  return {
    delivered: emailResult.delivered || smsResult.delivered,
    email: { attempted: emailAttempted, delivered: emailResult.delivered },
    sms: { attempted: smsAttempted, delivered: smsResult.delivered },
    quoteUrl,
  };
};


const deleteDraftJobSchema = z.object({ jobId: z.string().uuid() });

// Delete a draft outright — the swipe action on the My work drafts list.
//
// This is the one hard delete in the pipeline, and it is narrow on purpose:
// assessDraftDeletion has to agree the job has never left draft and carries no
// contract, invoice or recorded cost before a row is touched. Anything else is
// archiveQuote's job. The job row is what gets deleted, not the quote: quotes
// cascade from jobs, so one delete takes the abandoned draft and its scope with
// it and leaves nothing orphaned.
//
// RLS scopes both the read and the delete to the signed-in contractor, so a
// hand-crafted jobId for someone else's draft reads back as "not found".
export const deleteDraftJob = async (
  input: z.infer<typeof deleteDraftJobSchema>,
): Promise<void> => {
  const { jobId } = deleteDraftJobSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, quotes(status, contracts(id), invoices(id)), job_costs(id)")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) throw new Error("Draft not found");

  const verdict = assessDraftDeletion(job as unknown as DeletionCandidate);
  if (!verdict.deletable) throw new Error(verdict.reason);

  const { error } = await supabase.from("jobs").delete().eq("id", jobId);
  if (error) throw new Error(error.message);

  revalidatePath("/jobs");
  revalidatePath("/dashboard");
};

const markWorkCompleteSchema = z.object({
  jobId: z.string().uuid(),
  complete: z.boolean(),
});

// Mark a job's work as complete, or undo that marking. Sets or clears
// work_completed_at on the job row. Idempotent: marking complete when already
// complete, or undoing when already null, is a no-op (the timestamp is already
// in the target state).
//
// Server-side, this refuses to mark complete when the contract is not signed —
// the UI does not offer the control in that state, but the action guards against
// a hand-crafted call or a race. A job with no contract at all is refused too,
// even though some contractors skip straight to invoicing today: completion is
// only meaningful after a contract exists.
export const markWorkComplete = async (
  input: z.infer<typeof markWorkCompleteSchema>,
): Promise<{ success: boolean } | { error: string }> => {
  const { jobId, complete } = markWorkCompleteSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Read the contract state to guard the write: only signed contracts allow
  // completion. This is a separate select, not a join on the UPDATE, because
  // the UPDATE's RLS already scopes to the signed-in contractor's jobs — we
  // are checking the contract's status, not ownership.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, quotes(contracts(status, signed_at))")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return { error: "Job not found" };

  const contract = (
    job.quotes as unknown as { contracts: { status: string; signed_at: string | null }[] }[]
  )?.[0]?.contracts?.[0];

  // Refuse to mark complete unless the contract is signed. Undoing (complete =
  // false) has no such guard — a misfire must be reversible even if the
  // contract is unsigned or absent.
  if (complete && contract?.status !== "signed") {
    return { error: "Work can only be marked complete after the contract is signed." };
  }

  const { error } = await supabase
    .from("jobs")
    .update({
      work_completed_at: complete ? new Date().toISOString() : null,
    })
    .eq("id", jobId);

  if (error) return { error: error.message };

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");

  return { success: true };
};
