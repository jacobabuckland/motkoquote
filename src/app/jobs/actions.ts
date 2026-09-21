"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  ownershipChangeFlag,
  ownershipConflictFlag,
  reconcileMaterialsSupply,
} from "@/lib/voice/materials-ownership";
import { extractStatedQuantities } from "@/lib/voice/stated-quantities";
import { contractorSaid } from "@/lib/voice/contractor-said";
import { extractPricingDeferrals } from "@/lib/voice/pricing-deferrals";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import {
  ACCOUNT_REALTIME_TOOLS,
  BASE_REALTIME_TOOLS,
  buildJobIntakeInstructions,
} from "@/lib/voice/job-intake-prompt";
import { generateSowNarrative, draftQuoteLineItems } from "@/lib/claude";
import { computeQuoteTotals } from "@/lib/quote-math";
import type { SupabaseClient } from "@supabase/supabase-js";
import { vatRecordFor } from "@/lib/vat-record";
import { hasContract, quoteEditability, WRITABLE_QUOTE_STATUSES } from "@/lib/quote-editability";
import { totalMoved } from "@/lib/reissue-notice";
import { createInvoiceRecord } from "@/lib/invoicing";
import { applySelectiveReprice } from "@/lib/selective-reprice";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { sendQuoteSchema } from "@/lib/quote-send-guards";
import { embeddedOne, embeddedMany, type Embedded } from "@/lib/postgrest-embed";
import {
  sowToExtraction,
  mergeSowToolDelta,
  summarizeRequiredSlotCoverage,
  EMPTY_SOW_STATE,
  resolvePricingMode,
  pricingModeSchema,
  getMissingCustomerDetails,
  missingSiteAddress,
  endedOnCap,
  outOfScopeNotes,
  CHECKLIST_QUESTION_IDS,
  type SowState,
  type ChecklistQuestionId,
  type CustomerDetailSlot,
} from "@/lib/schemas/sow";
import { applyPricingMode, fixedAmountAfterEdit } from "@/lib/pricing-mode";
// Whether the rendered quote will carry a scope section decides the wording of
// the fixed-mode works line, so the persisted description matches the document
// it will appear on.
import { buildQuoteScope } from "@/lib/pdf/quote-payload";
import { notifyCustomer } from "@/lib/notify-customer";
import { normalizeUkPhone } from "@/lib/phone";
import {
  hasCustomerDetail,
  persistJobCustomer,
  type CustomerDetails,
} from "@/lib/persist-job-customer";
import { findSimilarPastJobs, syncQuoteKnowledge } from "@/lib/knowledge";
import { countLearnedQuotes } from "@/lib/learned-quotes";
import { findKnownMaterialPrices, rememberMaterialPrices } from "@/lib/materials";
import {
  compileDraftToLineItems,
} from "@/lib/compile-draft";
import { hasPricingHistory } from "@/lib/pricing-history";
import {
  clearUnpricedWhenPriced,
  reconcileUnpricedFlags,
  hasUnpricedLabour,
  hasUnpricedNonLabour,
} from "@/lib/unpriced-flags";
import {
  withStatedPriceFlag,
  reconcileStatedPrice,
  provisionalsRepeatingFixedPrice,
} from "@/lib/stated-price-guard";
import {
  agreedFixedPriceInEffect,
  applyAgreedDayRate,
  applyAgreedFixedPrice,
} from "@/lib/agreed-costs";
import { usedGenericFallback } from "@/lib/question-packs/fallback";
import { extractStatedPrices } from "@/lib/voice/stated-prices";
import { diffLineItems, getContractorTendencies, recordQuoteEdits } from "@/lib/quote-learning";
import { track, logError } from "@/lib/analytics";
import { actionableError } from "@/lib/actionable-error";
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
  PRICING_MODE_NOT_RECORDED,
  FIXED_PRICE_NOT_RECORDED,
  quoteExceedsCeiling,
  overCeilingConfirmMessage,
} from "@/lib/quote-send-guards";
import { withCustomerDetailsFlag } from "@/lib/customer-details-guard";
import { z } from "zod";
import { accessRestrictedMessage, isAccessRestricted } from "@/lib/subscription";

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

const createRealtimeSessionSchema = z.object({
  jobId: z.string().optional(),
});

// Starts a new SoW job and mints a Realtime session personalised to the
// contractor. Trade-defaulting and recent-job context are baked into the
// system instructions once, up front — the whole conversation now happens
// live over one continuous WebRTC connection instead of turn-by-turn
// record → transcribe → LLM → synthesize server round trips.
//
// #726: when jobId is provided, binds to that existing job instead of creating
// a new one (voice repair path). The job's existing sow_json seeds the
// conversation so Motko knows what has already been captured.
export const createRealtimeSession = async (
  input?: z.infer<typeof createRealtimeSessionSchema>,
): Promise<RealtimeSessionResult> => {
  const { jobId: existingJobId } = input ? createRealtimeSessionSchema.parse(input) : { jobId: undefined };
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, trade, first_name, day_rate")
    .eq("owner_user_id", user.id)
    .single();
  if (!contractor) throw new Error("No contractor profile — finish setup first");

  // SUB-4: Check subscription status before allowing creation
  const { data: projection } = await supabase
    .from("subscription_projection")
    .select("subscription_status")
    .eq("contractor_id", contractor.id)
    .maybeSingle();

  if (isAccessRestricted(projection?.subscription_status ?? null)) {
    throw actionableError(accessRestrictedMessage(projection?.subscription_status ?? null));
  }

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
  // Whether this contractor has ever finished a job before, and whether they
  // have a day rate on file. Both are counts and flags, NOT retrieved content —
  // nothing here carries a past job's scope or a priced line item, so neither
  // can become the retrieval that was removed above.
  //
  // They exist because a first run is genuinely different (D15): with no
  // history there is nothing to anchor a price on, so the agent has to say so
  // and ask, rather than let the drafting model fill the gap from nothing.

  // #726: when binding to an existing job for repair, fetch it and verify ownership
  let jobId: string;
  let existingSow: SowState | null = null;
  let savedTeam: unknown;
  let priorJobs: number | null;

  if (existingJobId) {
    // Repair path: bind to existing job, then fetch team and prior jobs
    // The jobId to return is the one we were given — we don't need to read it back
    jobId = existingJobId;

    const { data: existingJob, error: fetchError } = await supabase
      .from("jobs")
      .select("id, sow_json")
      .eq("id", existingJobId)
      .eq("contractor_id", contractor.id)
      .single();
    if (fetchError || !existingJob) throw new Error("Job not found");

    existingSow = (existingJob.sow_json as SowState | null) ?? null;

    // Fetch team and prior jobs after binding
    const [teamResult, priorJobsResult] = await Promise.all([
      supabase
        .from("team_members")
        .select("name, role, day_rate")
        .eq("contractor_id", contractor.id),
      supabase
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("contractor_id", contractor.id)
        .eq("status", "drafted"),
    ]);
    savedTeam = teamResult.data;
    priorJobs = priorJobsResult.count;
  } else {
    // New job path: preserve the exact Promise.all structure from main so
    // existing tests that stub this query pattern continue to work unchanged.
    // The repair path above is entirely gated on existingJobId, so a session
    // created without a job ID never takes that path.
    const [{ data: newJob, error }, { data: teamData }, { count: jobCount }] =
      await Promise.all([
        supabase
          .from("jobs")
          .insert({ contractor_id: contractor.id, status: "sow_in_progress" })
          .select("id")
          .single(),
        supabase
          .from("team_members")
          .select("name, role, day_rate")
          .eq("contractor_id", contractor.id),
        supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractor.id)
          // "drafted" is the status a job reaches once its quote exists — the
          // one unambiguous marker of a job this contractor has taken all the
          // way through before. Verified against production rather than
          // inferred: the mid-pipeline statuses are "processing" and
          // "extracted", and "sow_in_progress" is the row this very call just
          // inserted.
          .eq("status", "drafted"),
      ]);
    if (error || !newJob) throw new Error(error?.message ?? "Failed to create job");
    jobId = newJob.id;
    savedTeam = teamData;
    priorJobs = jobCount;
  }

  // OBS-1 — the opening end of the voice funnel. Emitted here, at the moment
  // the row exists and before the client secret is minted, because everything
  // after this point can fail in a way the contractor never reports: a denied
  // microphone, a failed negotiation, a closed tab. Without this event a
  // session that never started and one that hung on "Listening" are the same
  // absence in the data.
  //
  // run_id IS the job id, deliberately, rather than a second identifier and a
  // migration to hold it. It satisfies every criterion the item asks for — one
  // session followable across stages, and a retry sharing its original id,
  // since redraftJob reuses the same job — and a column that adds nothing the
  // contract needs is a manual production migration for no gain.
  await track("voice_session_started", { run_id: jobId, job_id: jobId });

  const instructions = buildJobIntakeInstructions({
    firstName: contractor.first_name,
    trade: contractor.trade,
    includeAccountTools: true,
    teamMembers: (savedTeam ?? []) as unknown as TeamMember[],
    isFirstJob: (priorJobs ?? 0) === 0,
    hasDayRate: contractor.day_rate != null,
    // #726: pass existing SoW for repair mode
    existingSow,
  });

  const clientSecret = await createRealtimeClientSecret({ instructions, tools: REALTIME_TOOLS });

  return { jobId, clientSecret };
};

// Typed-quote fallback for when the voice intake can't run (microphone denied,
// in use, or no hardware). Creates an empty draft job + quote so the
// contractor lands straight in the quote editor and builds the whole thing by
// hand — no LLM, no microphone. Mirrors the shape completeSowConversation
// leaves behind (a job with a draft quote) so the job hub renders identically.
export const createManualJob = async (): Promise<{ jobId: string }> => {
  const { createClient } = await import("@/lib/supabase/server");
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

  // SUB-4: Check subscription status before allowing creation
  const { data: projection } = await supabase
    .from("subscription_projection")
    .select("subscription_status")
    .eq("contractor_id", contractor.id)
    .maybeSingle();

  if (isAccessRestricted(projection?.subscription_status ?? null)) {
    throw actionableError(accessRestrictedMessage(projection?.subscription_status ?? null));
  }

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
  jobId: z.string(),
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
  requiredSlotsAsked: z.array(z.enum(CHECKLIST_QUESTION_IDS)).optional(),
  // #749 — whether customer_name was asked during the call. Tracked separately
  // from requiredSlotsAsked because customer_name is not a checklist slot.
  // Optional so manual/typed fallbacks don't have to supply it.
  customerNameAsked: z.boolean().optional(),
  // Fix 4 — required slots the live call ended without ever asking (channel
  // gone before the wrap detour, or the detour timed out unanswered). Persisted
  // onto sow_json as the wrap_incomplete flag so the job page can surface a "tap
  // to answer" prompt. Optional; the manual/typed fallbacks never run a live
  // call and so never leave a slot unasked.
  unaskedRequired: z.array(z.enum(CHECKLIST_QUESTION_IDS)).optional(),
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
    customerNameAsked,
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
    .select("id, sow_json, status")
    .eq("id", jobId)
    .eq("contractor_id", contractor.id)
    .single();
  if (jobError || !job) throw new Error(jobError?.message ?? "Job not found");

  // #726: check quote status BEFORE any processing or drafting
  // This must happen before ANY expensive work (knowledge lookups, Claude calls)
  const { data: existingQuote, error: quoteError } = await supabase
    .from("quotes")
    .select("id, status, line_items_json, drafted_line_items_json, contractor_flags_json, total")
    .eq("job_id", jobId)
    .maybeSingle();

  // If there was an error querying for the quote, fail early
  if (quoteError) throw new Error(quoteError.message ?? "Failed to check quote status");

  // If the job has status "drafted", it MUST have a quote. If we can't find it,
  // refuse rather than proceeding with drafting (which would create a duplicate)
  if (job.status === "drafted" && !existingQuote) {
    throw actionableError("Job marked as drafted but quote not found");
  }

  // If quote exists and is not editable, refuse immediately before any drafting
  if (existingQuote && !isEditableQuoteStatus(existingQuote.status as string)) {
    throw actionableError("Quote is not editable after customer has responded");
  }

  let sowState: SowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  // Fix 4 — a call that ended without ever asking a required slot is flagged on
  // the SoW so the job page can prompt "tap to answer" rather than presenting a
  // complete-looking quote built on a slot the contractor was never asked.
  const unaskedRequiredSlots = unaskedRequired ?? [];
  // VOICE-3 — also flag missing customer details (name, or no contact channel)
  const missingCustomerDetails = getMissingCustomerDetails(sowState);
  // N2.4 — and the site address, reported separately (see missingSiteAddress).
  // P1·6 kept it out of both lists; 11 of the 15 signed contracts have no site
  // address, so it is now reported. It still never gates a wrap — the detour
  // reads the checklist slots, not this.
  const allUnaskedRequired: (ChecklistQuestionId | CustomerDetailSlot)[] = [
    ...unaskedRequiredSlots,
    ...missingCustomerDetails,
    ...missingSiteAddress(sowState),
  ];
  // PRICE-1: extract stated prices from the transcript for the price-fidelity chain
  // PFIX-2: pass speaker-labelled turns so only contractor speech drives extraction
  const statedPrices = transcript ? extractStatedPrices(transcript, conversationTurns) : [];
  sowState = {
    ...sowState,
    complete: true,
    next_question: undefined,
    used_generic_fallback: usedGenericFallback(sowState.job_type),
    wrap_incomplete: allUnaskedRequired.length > 0,
    unasked_required: allUnaskedRequired,
    stated_prices: statedPrices,
    // VOICE-4: flag when the call was cut short by a cap
    cap_ended: wrapReason ? endedOnCap(wrapReason) : false,
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
    pastQuoteCount,
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
    countLearnedQuotes(contractor.id),
  ]);

  sowState = { ...sowState, overview_narrative: overviewNarrative };

  // WHO SUPPLIES WHAT, RECONCILED AGAINST WHAT WAS SAID, before any of it is
  // stored or drafted from.
  //
  // Intake recorded both materials as customer-supplied on job 1d6389a8 although
  // the contractor said "I'll bring both". Nothing downstream could catch that:
  // the drafter renders what it is given, and every layer below was working
  // correctly on a wrong premise. So the correction belongs here, between the
  // capture and everything that reads it.
  //
  // It moves an item only on an EXPLICIT statement, and leaves the captured
  // value alone otherwise -- see materials-ownership.ts for why "I need" is
  // deliberately not one.
  //
  // Read from the CONTRACTOR'S turns, not the whole call: Motko asks "so the
  // customer's supplying the tiles?" in the ordinary course of an intake, and
  // read whole that is a customer claim in the assistant's mouth.
  const reconciledSupply = reconcileMaterialsSupply(
    sowState.materials_supply,
    transcript,
    conversationTurns,
  );
  if (reconciledSupply.changes.length > 0) {
    sowState = { ...sowState, materials_supply: reconciledSupply.supply };
  }

  // HOW MANY, AS A NUMBER, where the contractor said one and no price followed.
  //
  // A count stated beside a price already survives (#796). A count stated on
  // its own had nowhere structured to go, so it reached the drafter only as
  // prose inside `quantity_guidance` — and the drafting model puts the count in
  // the description and leaves `quantity` at 1. Eight bags billed as one.
  //
  // Read from the transcript rather than asked of the model, and written beside
  // the prose rather than over it: see stated-quantities.ts for what it refuses.
  const statedQuantities = extractStatedQuantities(transcript ?? "", conversationTurns);
  if (statedQuantities.length > 0) {
    sowState = {
      ...sowState,
      materials_supply: {
        ...(sowState.materials_supply ?? { contractor_supplied: [], customer_supplied: [] }),
        quantities: statedQuantities,
      },
    };
  }

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

  // #726 criterion 6: "re-prices only the affected lines"
  // The spec (line 28) says "Redrafting (wholesale line-item replacement) on a
  // repair" is out of scope, but "re-price only what changed" is IN scope (line
  // 64). When repair fills in crew/duration from unasked_required, those are
  // pricing inputs and labour lines need re-pricing. applySelectiveReprice gives
  // selective re-pricing: redraft to get new pricing based on updated inputs,
  // then merge back any hand-edited prices. Lines whose inputs changed get new
  // prices; lines the contractor edited keep theirs.
  let finalLineItems: LineItem[];
  let calculatedLineItems: LineItem[];
  let flagsWithCustomerCheck: string[];

  // Both paths draft: new quote from scratch, repair with updated inputs
  {
    const draft = await draftQuoteLineItems(
      extraction,
      {
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
      },
      statedPrices,
    );

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
        has_pricing_history: hasPricingHistory({
          knownMaterialPrices,
          rateCards: rateCards ?? [],
          // PFIX-4: a COUNT OF PAST QUOTES, not whatever retrieval ranked.
          // `similarPastJobs` still feeds the prompt as context, but it filters
          // on contractor_id alone, so the business-setup chunk satisfied this
          // on a contractor's very first quote.
          pastQuoteCount,
        }),
        // What intake actually captured about how long the job takes and who
        // is on it. Absent, the labour line's days are the model's and are
        // labelled as assumed rather than attributed to the contractor.
        labour_plan: sowState.labour_plan ?? null,
        // Work the contractor kept out of the price, so a line describing it
        // does not sit unpriced in the payable table and block the quote.
        out_of_scope_notes: outOfScopeNotes(sowState),
        // The contractor's own words, so an unpriced material the model
        // invented can be told from one they raised and never priced.
        contractor_said: contractorSaid(transcript, conversationTurns),
        // Where they asked for a price to be left, which outranks any price
        // already on file for that material.
        pricing_deferrals: extractPricingDeferrals(transcript ?? "", conversationTurns).map(
          (deferral) => deferral.transcript_span,
        ),
      },
      draft.contractor_flags,
      statedPrices,
      statedQuantities,
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

    // #726 criterion 6: re-price only the lines the conversation touched.
    //
    // The redraft prices every line afresh. Adopting all of it moves figures on
    // lines nobody discussed, purely on model variability; adopting none of it
    // means capturing the real crew size changes no labour price, which is the
    // point of the repair. applySelectiveReprice takes the new price only where
    // a line's own pricing inputs moved, keeps the stored price where they did
    // not, and lets a hand-edited price outrank both. See selective-reprice.ts.
    const repricedItems = existingQuote
      ? applySelectiveReprice(
          compiledItems,
          (existingQuote.line_items_json as LineItem[] | null) ?? [],
        )
      : compiledItems;

    // Deterministic override — if the contractor already agreed a day rate
    // or fixed price with the customer before this quote (checklist question
    // 5), that figure is honoured exactly, taking precedence over the computed
    // rates. Day rate first (affects only labour lines), then fixed price
    // (reconciles the whole quote) — if both were somehow agreed, the fixed
    // price is what the customer expects to see as the total, so it wins.
    //
    // The agreed fixed price goes through agreedFixedPriceInEffect rather than
    // straight off the SoW: in "fixed" mode the contractor has restated the price
    // for THIS quote and applyPricingMode below is about to replace these lines
    // entirely, so scaling them first only corrupts the drafted baseline.
    const dayRatedItems = applyAgreedDayRate(repricedItems, sowState.agreed_costs?.day_rate);
    calculatedLineItems = applyAgreedFixedPrice(
      dayRatedItems,
      agreedFixedPriceInEffect(sowState),
    );

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

    // The stated price must survive to the document. If it did not, the
    // contractor is told which two figures disagree rather than being handed a
    // complete-looking quote at a price nobody chose. See stated-price-guard.
    const flagsWithPriceCheck = withStatedPriceFlag(
      contractorFlags,
      sowState,
      lineItems,
      calculatedLineItems,
    );

    // A call that ends without a name or a contact channel must be VISIBLE, not
    // silently handed over as a complete-looking quote. The send already blocks
    // on both, so this does not add a gate — it moves the discovery from the
    // moment the contractor tries to send to the moment they open the quote.
    // See customer-details-guard for why this flags rather than forces a
    // question (#373).
    // Anything the ownership guard moved is said out loud, with the words that
    // moved it, so the contractor can disagree with it on the line rather than
    // discover it on a document the customer is reading.
    // A contradiction between what was said about supply and what was said
    // about price is asked about rather than decided — see materials-ownership.
    const flagsWithOwnership = [
      ...flagsWithPriceCheck,
      ...reconciledSupply.changes.map(ownershipChangeFlag),
      ...reconciledSupply.unresolved.map(ownershipConflictFlag),
    ];

    flagsWithCustomerCheck = withCustomerDetailsFlag(flagsWithOwnership, sowState);

    finalLineItems = lineItems;
  }

  const finalTotal = computeQuoteTotals(finalLineItems, contractor.vat_registered).total;

  let quote: { id: string };
  if (existingQuote) {
    // #726: repair path - update existing quote
    const { data: updated, error: updateError } = await supabase
      .from("quotes")
      .update({
        line_items_json: finalLineItems,
        drafted_line_items_json: calculatedLineItems,
        contractor_flags_json: flagsWithCustomerCheck,
        total: finalTotal,
        // Recorded, not inferred later — see vat-record.ts and migration 80.
        // The repair path writes it for the same reason the insert does: a
        // re-priced quote is a new figure, and what was charged must not be
        // recomputed later from a setting that can change.
        ...vatRecordFor(finalLineItems, contractor.vat_registered),
      })
      .eq("id", existingQuote.id)
      .in("status", [...EDITABLE_STATUSES])
      .select("id")
      .single();
    if (updateError || !updated) throw new Error(updateError?.message ?? "Failed to update quote");
    quote = updated;

    await track("quote_updated", { method: "voice_repair" });
  } else {
    // New quote path - insert
    const { data: inserted, error: insertError } = await supabase
      .from("quotes")
      .insert({
        job_id: job.id,
        line_items_json: finalLineItems,
        // Immutable baseline for the learning loop (see quote-learning.ts) and
        // the retained calculated breakdown for pricing-mode switches — this is
        // the full computed structure, distinct from line_items_json which holds
        // the active view (collapsed in fixed mode) and mutates on save.
        drafted_line_items_json: calculatedLineItems,
        // Editor-only prompts — never rendered on a customer document.
        contractor_flags_json: flagsWithCustomerCheck,
        total: finalTotal,
        // Recorded, not inferred later — see vat-record.ts and migration 80.
        ...vatRecordFor(finalLineItems, contractor.vat_registered),
        status: "draft",
      })
      .select("id")
      .single();
    if (insertError || !inserted) throw new Error(insertError?.message ?? "Failed to create quote");
    quote = inserted;

    await track("quote_created", { method: "voice" });
  }

  // Only update job status to "drafted" if it's not already there
  if (!existingQuote) {
    await supabase.from("jobs").update({ status: "drafted" }).eq("id", job.id);
  }

  // PFIX-4 removed a syncQuoteKnowledge call from here.
  //
  // A quote at status "draft" has been seen by nobody. Embedding it taught the
  // knowledge layer the drafting model's own figures, which then returned as
  // "similar past jobs" in the next quote's prompt — the invention fed itself,
  // and the pool grew with every draft whether or not a human ever looked.
  //
  // It also defeated the first-run guard one step later: those chunks made
  // hasPricingHistory true on the contractor's SECOND quote, so the protection
  // against invented prices lasted exactly one job.
  //
  // Learning now happens on send, in sendQuote's markSent, from the lines the
  // customer was actually shown.

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
      // OBS-1 — the same correlator the started/abandoned events carry, so one
      // session can be followed across stages from the events table alone.
      run_id: job.id,
      job_id: job.id,
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
      // VOICE-3 — now includes customer details gaps alongside checklist slots.
      wrap_incomplete: allUnaskedRequired.length > 0,
      unasked_required: allUnaskedRequired,
      // VOICE-3 — telemetry flag: how often does a call end without customer details?
      missing_customer_details: missingCustomerDetails.length > 0,
      // #749 — whether customer_name was asked during the call, for diagnosing
      // missing names (did Motko never ask, or did the contractor not answer?).
      customer_name_asked: customerNameAsked ?? false,
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
    .select("id, sow_json, transcript, conversation_json")
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
    .select("id, status, total, sent_total, contract:contracts(id, status)")
    .eq("job_id", jobId)
    .maybeSingle();
  // #727: the same rule updateQuoteLineItems asks, including the contract.
  // A redraft rewrites line_items_json and total, so it is an edit like any
  // other — and an accepted quote with no contract may now be redrafted, which
  // re-issues it.
  const redraftEditability = existingQuote
    ? quoteEditability(
        existingQuote.status as string,
        (existingQuote as { contract?: { id: string } | { id: string }[] | null }).contract,
      )
    : ({ editable: true, reissues: false } as const);
  if (!redraftEditability.editable) {
    throw actionableError(redraftEditability.reason);
  }
  const redraftReissues = redraftEditability.reissues;

  const sowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  const extraction = sowToExtraction(sowState);
  const statedPrices = sowState.stated_prices ?? [];
  // READ FROM THE SOW, NOT RE-EXTRACTED, and for the same reason `stated_prices`
  // is on the line above: a redraft has the stored answer already, and running
  // the reader again over the transcript could only ever produce it a second
  // time or disagree with what was stored.
  //
  // Absent here, a redraft silently handed the count back to the drafting
  // model — which writes it into the description and leaves `quantity` at 1 —
  // so a contractor who redrafted lost the correction and went back to being
  // billed for one bag of eight. The guard has to hold on every path that
  // rebuilds the lines, not just the first one.
  const statedQuantities = sowState.materials_supply?.quantities ?? [];

  const [
    { data: teamMembers },
    { data: rateCards },
    similarPastJobs,
    knownMaterialPrices,
    contractorTendencies,
    pastQuoteCount,
  ] = await Promise.all([
      supabase.from("team_members").select("id, name, role, day_rate").eq("contractor_id", contractor.id),
      supabase
        .from("rate_cards")
        .select("id, work_type, unit, rate_per_unit, complexity_notes")
        .eq("contractor_id", contractor.id),
      findSimilarPastJobs(contractor.id, `${extraction.job_type} ${extraction.scope_items.join(" ")}`),
      findKnownMaterialPrices(contractor.id, extraction.materials_mentioned),
      getContractorTendencies(contractor.id),
      countLearnedQuotes(contractor.id),
    ]);

  const draft = await draftQuoteLineItems(
    extraction,
    {
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
    },
    statedPrices,
  );

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
      has_pricing_history: hasPricingHistory({
        knownMaterialPrices,
        rateCards: rateCards ?? [],
        // PFIX-4: a COUNT OF PAST QUOTES, not whatever retrieval ranked.
        // `similarPastJobs` still feeds the prompt as context, but it filters
        // on contractor_id alone, so the business-setup chunk satisfied this
        // on a contractor's very first quote.
        pastQuoteCount,
      }),
      labour_plan: sowState.labour_plan ?? null,
      out_of_scope_notes: outOfScopeNotes(sowState),
      // READ FROM THE STORED CALL, on this path too. A redraft that could not
      // see the contractor's words would treat every material as unmentioned
      // -- so the guard is handed nothing, keeps everything, and the line it
      // removed on the first draft comes back. That is the #828 redraft gap
      // exactly: a guard has to hold on every path that rebuilds the lines.
      contractor_said: contractorSaid(
        job.transcript as string | null,
        transcriptTurnsSchema.safeParse(job.conversation_json).data ?? null,
      ),
      // Re-read on this path too, from the stored call. A redraft that could
      // not see the deferral would price the line from the figure on file --
      // the very thing the contractor asked to leave -- so the guard has to
      // hold wherever the lines are rebuilt. The #828 redraft gap again.
      pricing_deferrals: extractPricingDeferrals(
        (job.transcript as string | null) ?? "",
        transcriptTurnsSchema.safeParse(job.conversation_json).data ?? undefined,
      ).map((deferral) => deferral.transcript_span),
    },
    draft.contractor_flags,
    statedPrices,
    statedQuantities,
  );

  const dayRatedItems = applyAgreedDayRate(compiledItems, sowState.agreed_costs?.day_rate);
  const calculatedLineItems = applyAgreedFixedPrice(
    dayRatedItems,
    agreedFixedPriceInEffect(sowState),
  );
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
        withStatedPriceFlag(contractorFlags, sowState, lineItems, calculatedLineItems),
        sowState,
      ),
      total,
      ...vatRecordFor(lineItems, contractor.vat_registered),
      // #727, same three consequences as the editor path.
      ...(redraftReissues ? { accepted_at: null, status: "sent", sent_total: total, reissued_at: new Date().toISOString() } : {}),
    })
    .eq("job_id", jobId)
    .in("status", [...WRITABLE_QUOTE_STATUSES])
    .select("id");

  if (redraftError) throw new Error(redraftError.message);
  if (!redrafted || redrafted.length === 0) {
    throw actionableError(QUOTE_NOT_EDITABLE);
  }

  if (redraftReissues && existingQuote) {
    const prior = existingQuote as unknown as { id: string; total: number | null; sent_total: number | null };
    await announceReissue(supabase, prior.id, total, prior.sent_total ?? prior.total ?? total);
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
    .select("id, status, total, sent_total, line_items_json, drafted_line_items_json, contractor_flags_json, contract:contracts(id, status)")
    .eq("id", quoteId)
    .eq("job_id", jobId)
    .single();
  if (!quote) throw new Error("Quote not found");

  // #727: the same rule, including the contract. Switching mode rewrites
  // line_items_json and total, so it is an edit — an accepted quote with no
  // contract may now be repriced, which re-issues it.
  const modeEditability = quoteEditability(
    quote.status as string,
    (quote as { contract?: { id: string } | { id: string }[] | null }).contract,
  );
  if (!modeEditability.editable) {
    throw actionableError(modeEditability.reason);
  }
  const modeReissues = modeEditability.reissues;

  const sowState = (job.sow_json as SowState | null) ?? EMPTY_SOW_STATE;
  // The calculated breakdown is the source for every mode — fall back to the
  // current active lines when there is no stored drafted baseline.
  //
  // AN EMPTY BASELINE IS NO BASELINE. This used to be a `??` chain, which only
  // falls back on null/undefined — and `[] ?? x` is `[]`. A quote created
  // through "Type the quote in instead" is inserted with
  // `drafted_line_items_json: []` (see the manual-quote path above), so for
  // every hand-typed quote this resolved to an empty array and the
  // contractor's actual lines were never read.
  //
  // Everything the 13 Sep report described falls out of that one operator:
  // the fixed amount seeded from the subtotal of nothing (£0.00 rather than
  // the real total), applyPricingMode built a single works line at £0, and the
  // typed lines — which lived only in line_items_json — were overwritten by
  // it. Switching back read the same empty baseline and restored nothing. One
  // unguarded click, committed server-side before the contractor pressed Save,
  // with no undo.
  // A BASELINE IS ONLY A BASELINE WHILE THE QUOTE IS COLLAPSED.
  //
  // The first version of this seeded the baseline once and then never touched
  // it again, on the reasoning that a drafted breakdown is the model's own work
  // and must not be overwritten by a collapse of itself. That reasoning is
  // right; the rule drawn from it was not. It froze the baseline at whatever
  // the lines were the FIRST time the control was used, so every later collapse
  // read a snapshot that no longer described the quote:
  //
  //   £1,150 → £1,000  one line at the first switch; a £150 materials line
  //                    added afterwards was never in the baseline and was
  //                    destroyed by the second switch.
  //   £1,499 → £0.00   the first switch happened on an EMPTY quote, so the
  //                    baseline froze at a single £0 works line; four lines
  //                    typed afterwards collapsed to nothing.
  //
  // Both reported 13 Sep, both unrecoverable, and the confirmation dialog named
  // the right figure each time — it computes from the live client lines, which
  // is precisely the state the server was ignoring.
  //
  // The distinction the old rule was missing is the CURRENT mode:
  //
  //   * While the quote is itemised, `line_items_json` IS the breakdown. It is
  //     the contractor's own current pricing, edits included, and it is what a
  //     collapse must snapshot and what a collapse must be computed from. A
  //     stored baseline at this point is a stale record of an earlier collapse.
  //   * While the quote is already collapsed, `line_items_json` is the single
  //     works line and carries no breakdown at all. Only then is the stored
  //     baseline the thing to read — that is what makes the switch reversible.
  const currentMode = resolvePricingMode(sowState);
  const draftedBaseline = quote.drafted_line_items_json as LineItem[] | null;
  const activeLineItems = (quote.line_items_json as LineItem[] | null) ?? [];
  const hasDraftedBaseline = Boolean(draftedBaseline && draftedBaseline.length > 0);
  const restoringFromFixed = currentMode === "fixed";
  const calculatedLineItems =
    restoringFromFixed && hasDraftedBaseline ? (draftedBaseline as LineItem[]) : activeLineItems;

  // Write the baseline on the way IN to fixed mode, and only then. Snapshotting
  // on a restore is what poisoned the second case above: switching an empty
  // quote to fixed and back stored the £0 works line the collapse had just
  // created, as though it were a breakdown.
  const collapsingToFixed = mode === "fixed" && !restoringFromFixed;

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
      ...vatRecordFor(lineItems, contractor.vat_registered),
      // THE SWITCH RECORDS WHAT IT COLLAPSED, so it can be undone.
      //
      // A fixed-price switch replaces the itemised lines with one works line.
      // That is only reversible because "Switch to itemised" rebuilds from the
      // drafted baseline — and a hand-typed quote never had one, so the
      // collapse destroyed the contractor's pricing outright. On a £9,056
      // itemised job that is one click from losing all of it.
      //
      // Seeding the baseline here, from the lines that existed before the
      // collapse, is what makes the control non-destructive for a typed quote
      // in the same way it always was for a dictated one.
      //
      // Written on every collapse, not only the first — see the long note above
      // `collapsingToFixed`. The lines being snapshotted are the itemised ones
      // as they stand right now, so this overwrites a drafted breakdown only
      // with the contractor's own edited version of that same breakdown, which
      // is strictly more current. It can never overwrite it with a collapse of
      // itself, because a quote already in fixed mode does not take this
      // branch.
      ...(collapsingToFixed && activeLineItems.length > 0
        ? { drafted_line_items_json: activeLineItems }
        : {}),
      // Recomputed from the lines this switch is writing, both families. A
      // fixed-mode switch collapses several drafted lines into one works line,
      // so a blocking flag raised against a line that no longer exists must go
      // with it — that collapse is how the £540 quote of 3 Sep ended up
      // unsendable over a labour line it no longer had.
      contractor_flags_json: reconcileUnpricedFlags(
        withStatedPriceFlag(
          quote.contractor_flags_json as string[] | null,
          nextSow,
          lineItems,
          calculatedLineItems,
        ),
        lineItems,
      ),
      // #727, same three consequences as the other two write paths.
      ...(modeReissues ? { accepted_at: null, status: "sent", sent_total: total, reissued_at: new Date().toISOString() } : {}),
    })
    .eq("id", quote.id)
    .in("status", [...WRITABLE_QUOTE_STATUSES])
    .select("id");

  if (repriceError) throw new Error(repriceError.message);
  if (!repriced || repriced.length === 0) {
    throw actionableError(QUOTE_NOT_EDITABLE);
  }

  if (modeReissues) {
    const prior = quote as unknown as { total: number | null; sent_total: number | null };
    await announceReissue(supabase, quote.id as string, total, prior.sent_total ?? prior.total ?? total);
  }

  // Guarded like the quote UPDATE above it, and for the same reason. These are
  // two statements with no transaction, so a silent failure here leaves the
  // quote collapsed into fixed-mode figures with NO record of the mode that
  // collapsed it — a row indistinguishable from the legacy `pricing: null`
  // ones, and the switch reports success while the job page shows a mode the
  // contractor never chose. Throwing is recoverable: the retry recomputes from
  // the job's unchanged sow_json and rewrites the same quote.
  const { error: sowError } = await supabase
    .from("jobs")
    .update({ sow_json: nextSow })
    .eq("id", job.id);

  if (sowError) {
    throw actionableError(PRICING_MODE_NOT_RECORDED);
  }

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

const reportVoiceAbandonedSchema = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(["mic_denied", "connect_failed", "left", "unknown"]),
});

// OBS-1 — the closing end of the funnel for a session that never reached the
// post-call pipeline. `voice_session_completed` only fires on a wrap, so
// without this an abandoned call is indistinguishable from a call that was
// never begun: both are a job row with no transcript.
//
// Emitted from the client, because only the client knows the difference
// between a denied microphone and a contractor who walked away. A call that
// dies without any teardown at all cannot report itself — that residue is
// visible as a `voice_session_started` with no terminal event, which is
// exactly the comparison this pair makes possible.
export const reportVoiceAbandoned = async (
  input: z.infer<typeof reportVoiceAbandonedSchema>,
): Promise<void> => {
  const { jobId, reason } = reportVoiceAbandonedSchema.parse(input);
  await track("voice_session_abandoned", { run_id: jobId, job_id: jobId, reason });
};

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

/**
 * Tell the customer their acceptance is gone, and record it on the job.
 *
 * Shared by the write paths rather than copied into each, because three
 * subtly-different notices for the same event is the shape of the defect this
 * item exists to fix. It re-reads what it needs instead of asking every caller
 * to widen its own select: this runs only on the rare re-issue path, so one
 * extra query is cheaper than three call sites that can drift apart.
 *
 * NEVER THROWS. It runs AFTER the guarded UPDATE has already succeeded, so the
 * acceptance is already withdrawn. Throwing here would report a failed save for
 * a save that worked, the contractor would edit again, and a delivery problem
 * would become a second re-issue and a second notice.
 */
const announceReissue = async (
  supabase: SupabaseClient,
  quoteId: string,
  total: number,
  previousTotal: number,
): Promise<void> => {
  try {
    const { data } = await supabase
      .from("quotes")
      .select(
        "job:jobs(id, customer:customers(name, contact), contractor:contractors(company_name, vat_registered))",
      )
      .eq("id", quoteId)
      .maybeSingle();

    const job = (
      data as unknown as {
        job: {
          id: string;
          customer: {
            name: string;
            contact: { email?: string; phone?: string; sms_opt_out?: boolean } | null;
          } | null;
          contractor: { company_name: string; vat_registered: boolean } | null;
        } | null;
      } | null
    )?.job;

    if (!job?.contractor) return;

    await notifyCustomer({
      event: "quote_reissued",
      customer: {
        name: job.customer?.name ?? "there",
        email: job.customer?.contact?.email,
        phone: job.customer?.contact?.phone,
        smsOptOut: job.customer?.contact?.sms_opt_out === true,
      },
      companyName: job.contractor.company_name,
      url: `${process.env.NEXT_PUBLIC_APP_URL}/q/${quoteId}`,
      amount: total,
      previousAmount: previousTotal,
      vatRegistered: job.contractor.vat_registered,
    });

    // Decision (3) overwrites the quote BODY. The history of the job is not
    // overwritten with it — "Quote accepted" then "Quote re-issued" is what the
    // Activity timeline should read.
    await track("quote_reissued", {
      run_id: job.id,
      job_id: job.id,
      quote_id: quoteId,
      total_moved: totalMoved(previousTotal, total),
    });
  } catch (err) {
    console.error("quote_reissued announcement failed:", err);
  }
};

const updateQuoteSchema = z.object({
  jobId: z.string().uuid(),
  quoteId: z.string().uuid(),
  lineItems: z.array(lineItemSchema),
  // The deposit agreed with the customer, in pennies (migration 81).
  //
  // Three states, and they are three different answers:
  //   undefined — this save carries no view of the deposit field, so the
  //     stored value is left exactly as it is. A save from a surface that has
  //     no deposit control must never blank one that was agreed.
  //   null — the field was cleared: no deposit on this quote.
  //   0 — a deposit was agreed AT NOTHING, which is an answer. It is recorded
  //     so that signature raises no invoice rather than falling through to a
  //     percentage typed on the contract. See depositAtSignature.
  depositPennies: z.number().int().nonnegative().nullable().optional(),
  // THE OTHER HALF OF "SAVE CHANGES".
  //
  // This action wrote line_items_json and nothing else, so the customer name,
  // email, phone and site address typed into the send form were accepted, the
  // button reported "Saved", and they were gone on reload. They reached the
  // database only by SENDING the quote. Reported 13 Sep.
  //
  // Optional: a save from a surface that carries no customer fields is a
  // perfectly ordinary save, and must not blank an existing customer row.
  customer: z
    .object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      smsOptOut: z.boolean().optional(),
    })
    .optional(),
});

export const updateQuoteLineItems = async (
  input: z.infer<typeof updateQuoteSchema>,
) => {
  const { quoteId, lineItems, customer, depositPennies } = updateQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: quoteContext } = await supabase
    .from("quotes")
    .select(
      // drafted_line_items_json is selected for the absorbed-value flag: after a
      // fixed-price collapse the ACTIVE lines are the single works line, so the
      // value the collapse absorbed exists only in the breakdown. Without it a
      // save would STRIP the flag (its prefix is in the reconciliation family)
      // and have nothing to re-add.
      // The job's own id comes back with it rather than being taken from the
      // input: this now WRITES sow_json, and the quote's own job is the
      // authority on which row that is. A jobId off the wire is not.
      // `contract:contracts(id, status)` — the contract-presence input #727's rule
      // needs. `contracts.quote_id` is UNIQUE so this is a to-ONE embed, but it
      // is read through `hasContract` rather than `Boolean(...)`: an earlier
      // derivation of this item used truthiness, and Boolean([]) is true, which
      // would have frozen every accepted quote in production.
      "status, accepted_at, total, sent_total, contractor_flags_json, drafted_line_items_json, contract:contracts(id, status), job:jobs(id, customer_id, extracted_json, sow_json, customer:customers(name, contact), contractor:contractors(id, company_name, vat_registered))",
    )
    .eq("id", quoteId)
    .single();

  const context = quoteContext as unknown as {
    status: string;
    accepted_at: string | null;
    total: number | null;
    sent_total: number | null;
    contractor_flags_json: string[] | null;
    drafted_line_items_json: LineItem[] | null;
    contract: { id: string } | { id: string }[] | null;
    job: {
      id: string;
      customer_id: string | null;
      extracted_json: { job_type?: string; scope_items?: string[] } | null;
      sow_json: SowState | null;
      customer: { name: string; contact: { email?: string; phone?: string; sms_opt_out?: boolean } | null } | null;
      contractor: { id: string; company_name: string; vat_registered: boolean };
    };
  } | null;
  const job = context?.job;

  // #727. The rule is NOT a status list: `accepted` with no contract is
  // editable and re-issues; `accepted` with a contract is refused outright,
  // signed or unsigned. Same status, two answers — so the guard takes the
  // contract as an input, and every write path asks the same question.
  //
  // `reissues` is the second half and must not be dropped. Editing an accepted
  // quote withdraws an agreement, and three things follow below: accepted_at
  // cleared, sent_total updated, and the customer told.
  const editability = context
    ? quoteEditability(context.status, context.contract)
    : ({ editable: true, reissues: false } as const);
  if (!editability.editable) {
    throw actionableError(editability.reason);
  }
  const reissuing = editability.reissues;

  const vatRegistered = Boolean(job?.contractor?.vat_registered);

  // A line the contractor has just priced is no longer unpriced, so the "to be
  // confirmed" state comes off before anything is computed from these lines.
  // Otherwise the total includes the figure while the customer document still
  // says the item is excluded from it.
  const priced = clearUnpricedWhenPriced(lineItems as LineItem[]);

  const { total } = computeQuoteTotals(priced, vatRegistered);

  // N3 — the months-old divergence. In fixed mode the defined works ARE the
  // stated price, so editing them restates it; holding the old figure records a
  // price nobody chose. Null when nothing should change (not fixed mode, no
  // stated amount, already in agreement, or the works came to nothing) — see
  // fixedAmountAfterEdit, which is where each of those is argued.
  const priorSow = job?.sow_json ?? null;
  const nextFixedAmount = priorSow ? fixedAmountAfterEdit(priorSow, priced) : null;
  // The flags below are recomputed against the sow this save is ABOUT to write,
  // not the one it read. Reconciling the figure and then flagging the
  // divergence it just removed is how a guard teaches a contractor to ignore it
  // — the same reasoning setQuotePricingMode records for seeding a fixed amount.
  const nextSow: SowState | null =
    priorSow && nextFixedAmount != null
      ? { ...priorSow, pricing: { ...priorSow.pricing, mode: "fixed", fixed_amount: nextFixedAmount } }
      : priorSow;

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
      line_items_json: priced,
      total,
      ...vatRecordFor(priced, vatRegistered),
      // Spread only when the save actually carries the field, so a save from a
      // surface with no deposit control leaves an agreed deposit alone rather
      // than blanking it. `null` and `0` both reach the column; `undefined`
      // never does.
      ...(depositPennies !== undefined ? { deposit_pennies: depositPennies } : {}),
      // Both flag families are recomputed from the lines being written rather
      // than carried forward — the stated-price reconciliation as before, and
      // now the two SEND-BLOCKING flags too. Inheriting those is what left a
      // fully priced £540 quote unsendable with a message naming a day rate
      // that had been set for hours. See reconcileUnpricedFlags.
      contractor_flags_json: reconcileUnpricedFlags(
        withStatedPriceFlag(
          context?.contractor_flags_json,
          nextSow,
          priced,
          context?.drafted_line_items_json,
        ),
        priced,
      ),
      // #727, the three mechanical consequences of "overwritten".
      //
      // accepted_at is cleared, or the job page reads as accepted while
      // awaiting a second acceptance. The status goes back to `sent`, because
      // the quote IS out for a decision again — a re-issued quote must be
      // accepted again (decision 2).
      //
      // sent_total is updated to what the customer is now being told. Leave it
      // at the pre-edit figure and sentQuoteDivergence fires permanently on the
      // re-issued quote: the customer receives the re-issue notice and then
      // opens a quote telling them it disagrees with itself.
      ...(reissuing ? { accepted_at: null, status: "sent", sent_total: total, reissued_at: new Date().toISOString() } : {}),
    })
    .eq("id", quoteId)
    // Widened by exactly `accepted`. The contract half of the rule cannot be
    // expressed as a status filter and is asserted on the read above; this
    // predicate still exists to stop an ACCEPTANCE landing between the read and
    // the write from being silently overwritten, which is a customer-driven
    // race and a real one.
    .in("status", [...WRITABLE_QUOTE_STATUSES])
    .select("id");

  if (error) throw new Error(error.message);
  if (!updated || updated.length === 0) {
    throw actionableError(QUOTE_NOT_EDITABLE);
  }

  // THE CUSTOMER IS TOLD THEIR ACCEPTANCE IS GONE.
  //
  // After the guarded UPDATE, so a refused edit notifies nobody, and after the
  // row is actually written, so the notice can never describe a change that did
  // not happen. Through `notifyCustomer` rather than the senders directly,
  // because the dispatcher owns eligibility, the SMS opt-out and phone
  // normalisation — a per-site copy is how the opt-out ended up honoured at two
  // sends out of five.
  //
  // Delivery failure does not throw. The write has already happened and the
  // acceptance is already withdrawn; throwing here would report a failed save
  // for a save that succeeded, and the contractor would edit again. The job
  // page's own "not delivered" surfacing is the right place for that.
  if (reissuing) {
    await announceReissue(supabase, quoteId, total, context?.sent_total ?? context?.total ?? total);
  }

  // THE CUSTOMER DETAILS, saved by "Save changes" at last.
  //
  // Placed AFTER the guarded quote UPDATE deliberately, so an edit the guard
  // refuses cannot still write a customer row — a refused save must change
  // nothing at all, not merely nothing about the money.
  //
  // Only when the save actually carries a detail: a blank set means the
  // contractor did not touch those fields on this save, and must never blank
  // an existing customer or create an empty row.
  if (job && hasCustomerDetail(customer)) {
    await persistJobCustomer(supabase, {
      jobId: job.id,
      contractorId: job.contractor.id,
      customerId: job.customer_id,
      customer: customer as CustomerDetails,
    });
  }

  // Ordered and guarded exactly as setQuotePricingMode's pair is, for the reason
  // recorded there: two statements, no transaction, quote first. Writing the SoW
  // first would leave the job carrying a fixed price for lines the guard then
  // refused to save. Only runs when the figure actually moved, so an ordinary
  // edit outside fixed mode still writes one row.
  if (nextSow && nextFixedAmount != null && job) {
    const { error: sowError } = await supabase
      .from("jobs")
      .update({ sow_json: nextSow })
      // The quote's own job, never the jobId off the wire.
      .eq("id", job.id);
    // Loud, not swallowed. This write is the whole point of the item: a silent
    // failure here puts the stale figure straight back behind edited lines and
    // reports success, which is the defect wearing a fix's clothes.
    if (sowError) throw actionableError(FIXED_PRICE_NOT_RECORDED);
  }

  // PFIX-4 removed syncQuoteKnowledge and rememberMaterialPrices from here.
  //
  // Editing a draft is not approval — the card is explicit that a quote never
  // sent must not teach the knowledge layer. rememberMaterialPrices mattered
  // more than it looks: it wrote EVERY materials line with a price above zero
  // into contractor_material_prices stamped `confirmed_at`, whether the
  // contractor had touched that line or not. A model-invented £180 the
  // contractor never looked at became a "confirmed" supplier price, and a
  // confirmed price satisfies the first-run guard permanently. That is
  // laundering an invented number into evidence.
  //
  // Both now run on send, from the lines the customer was actually shown.

  return { total };
};


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
    confirmOverCeiling,
  } = sendQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("contractor_id, customer_id, sow_json, extracted_json, contractor:contractors(company_name, vat_registered)")
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
    // sow_json for the provisional-duplicate check below: the stated fixed
    // price lives there, and the active lines alone cannot say whether a
    // provisional sum repeats it.
    .select(
      "total, line_items_json, drafted_line_items_json, contractor_flags_json, job:jobs(sow_json)",
    )
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  // Two different situations, deliberately not merged.
  //
  // A line the compiler could not price is a MISSING figure: the quote is
  // incomplete and the contractor can fix it in seconds by entering a rate, so
  // this blocks and says which. It guards on the lines, not on the amount —
  // an unpriced line among priced ones produces a perfectly non-zero total.
  //
  // DERIVED FROM THE LINES BEING SENT, not from the stored flag.
  //
  // Both conditions are defined as properties of the line items, so evaluating
  // them here — against the very lines about to go out — is strictly more
  // accurate than trusting a value written at some earlier moment. Reading the
  // stored flag is what made quote b3112196 permanently unsendable: fixed price
  // £450, one works line at £450, total £540, every figure present, refused
  // over a flag left behind by a compile of four lines that no longer existed.
  //
  // Recomputing on edit (see reconcileUnpricedFlags) fixes the NEXT quote, but
  // it cannot rescue one already carrying a stale flag unless the contractor
  // happens to edit it again — so a quote stuck before that fix shipped would
  // have stayed stuck. Deriving at the point of the check has no such gap and
  // needs no backfill of production rows.
  //
  // The protection is unchanged: a quote whose lines really are unpriced still
  // blocks, with the same wording. The stored flags remain what the editor's
  // "before you send" list reads, which is advisory; nothing load-bearing
  // depends on them staying fresh any more.
  const sendingLineItems = (quote.line_items_json ?? []) as LineItem[];

  if (hasUnpricedLabour(sendingLineItems)) {
    // Two causes now reach this guard, and naming only the first sends half
    // the people who hit it to a screen where nothing is wrong. A contractor
    // whose own day rate has been set for months gets here when the crew
    // includes someone who is not in their team — the line is unpriced
    // because Motko will not bill an unknown person at the owner's rate (see
    // resolvePerson in compile-draft.ts). The editor flag names the line; this
    // has to name both ways out, because it is the one that stops the send.
    throw actionableError(
      "This quote isn't priced: some labour has no rate behind it. Add the missing " +
        "day rate in Business details — your own, or the crew member's — or price " +
        "the line yourself, then send.",
    );
  }

  // Same situation, different line kind (D16). A material with no supplier
  // price behind it is a missing figure just as a labour line without a rate
  // is, and it must not go out as a £0.00 a customer reads as free. Blocked
  // separately because the fix is different — enter what you pay on the line,
  // rather than set a rate once in Settings.
  if (hasUnpricedNonLabour(sendingLineItems)) {
    throw new Error(
      "Some lines on this quote aren't priced: there's no confirmed price on file to " +
        "work from, so nothing was guessed. Enter what you charge on each unpriced line, then send.",
    );
  }

  // A provisional sum priced at the whole fixed price is the works line
  // duplicated, and it doubles what the customer is billed. Quote 09F065E5 went
  // out at £1,248 for a job the contractor priced at £520 + VAT, and every
  // internal check agreed with it: reconcileStatedPrice compares the stated
  // figure against the DEFINED works, and provisionals are excluded there by
  // design. See provisionalDuplicatesPriceFlag.
  //
  // Derived here rather than read from contractor_flags_json, for the same
  // reason the unpriced checks above are: a quote saved before this shipped
  // carries no such flag, and nothing load-bearing should depend on a stored
  // flag being fresh. Blocked rather than auto-corrected — removing the line
  // would be the code deleting priced work on its own judgement, which is how
  // quote 46E3D510 lost £555.98.
  const duplicatedProvisionals = provisionalsRepeatingFixedPrice(
    (quote.job as { sow_json?: SowState | null } | null)?.sow_json ?? null,
    sendingLineItems,
  );
  if (duplicatedProvisionals.length > 0) {
    throw actionableError(
      `"${duplicatedProvisionals[0].description}" is marked as a provisional sum and ` +
        `priced at the whole fixed price, so it is being charged on top of the works ` +
        `line and this quote is double what you agreed. Remove the line if it IS the ` +
        `work, or correct its amount if it is a genuine allowance, then send.`,
    );
  }

  // A zero total with no such flag is a DELIBERATE figure — a goodwill callout,
  // a warranty visit. Confirm it, never block it.
  if (Number(quote.total) === 0 && !confirmZeroTotal) {
    throw actionableError(ZERO_TOTAL_CONFIRM_REQUIRED);
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
      throw actionableError(
        narrativeConfirmMessage(narrative.statedAmount, netSubtotal),
      );
    }
  }

  // Quotes above the Pay by Bank limit (£10,000) must be confirmed before
  // sending. The contractor sees a dialog explaining that large jobs use the
  // staged payment path, framing it as a capability rather than an apology.
  // This runs against the VAT-inclusive total — what the customer will be asked
  // to pay — matching the check in pay-panel.ts.
  if (!confirmOverCeiling && quoteExceedsCeiling(Number(quote.total))) {
    throw actionableError(overCeilingConfirmMessage(Number(quote.total)));
  }

  // Per-amount reconciliation gate (PRICE-4): every stated amount must map to
  // exactly one line, and every line must have provenance. Blocks send when
  // the invariant fails.
  const sow = (job.sow_json as SowState | null) ?? null;
  const reconciliationError = reconcileStatedPrice(
    sow,
    (quote.line_items_json as LineItem[]) ?? [],
  );
  if (reconciliationError) {
    // Determine failure kind and count actual failures
    // The error may contain multiple failures; count each type
    const unsourcedCount = (reconciliationError.match(/Unsourced line:/g) || []).length;
    const amountMismatchCount = (reconciliationError.match(/Amount mismatch:/g) || []).length;
    const duplicateCount = (reconciliationError.match(/Duplicate amount:/g) || []).length;

    const totalFailures = unsourcedCount + amountMismatchCount + duplicateCount;

    // Determine primary failure kind by priority: unsourced > duplicate > mismatch
    let failureKind: "amount_mismatch" | "unsourced_line" | "duplicate_amount" =
      "amount_mismatch";
    if (unsourcedCount > 0) {
      failureKind = "unsourced_line";
    } else if (duplicateCount > 0) {
      failureKind = "duplicate_amount";
    }

    // Log the gate failure
    await track("gate_failure", {
      gate: "price_reconciliation",
      job_id: jobId,
      failure_kind: failureKind,
      failure_count: totalFailures,
    });

    throw actionableError(reconciliationError);
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

  // Deliberately still computed here as well as inside buildCustomerContact,
  // because the two uses differ: the STORED contact keeps the typed number when
  // it cannot be parsed, so nothing the contractor entered is lost, while the
  // SMS dispatch below takes `normalizedPhone ?? undefined` and simply does not
  // text an unparseable number.
  const normalizedPhone = customer.phone ? normalizeUkPhone(customer.phone) : null;

  // The upsert itself now lives in persist-job-customer.ts, because "Save
  // changes" needs the identical write and had none — a contractor's typed
  // customer details reached the database only by sending the quote.
  await persistJobCustomer(supabase, {
    jobId,
    contractorId: job.contractor_id,
    customerId: job.customer_id,
    customer,
  });

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

    // NOTIF-3: Stamp first_quote_sent_at on the contractor's first send.
    // Idempotent: the WHERE clause ensures we only write once, on the first
    // send from any device. This is the trigger for the in-app push permission
    // prompt, which shows on the next app open after this is set.
    const { data: contractor } = await supabase
      .from("contractors")
      .select("first_quote_sent_at")
      .eq("id", job.contractor_id)
      .single();

    if (contractor && contractor.first_quote_sent_at === null) {
      await supabase
        .from("contractors")
        .update({ first_quote_sent_at: new Date().toISOString() })
        .eq("id", job.contractor_id);

      // REF-4: this same moment activates a referral in which this trade is the
      // referee. Inside the null check, so it can only run on the genuine first
      // send — the same idempotence that gates the push prompt above.
      //
      // SERVICE ROLE, because the rows written belong to the REFERRER: their
      // free-job balance and activation count. The sending trade's own session
      // has no business touching those and RLS correctly forbids it.
      //
      // BEST EFFORT. A trade sending a quote to their customer must never see
      // it fail because a referral reward could not be written — the quote is
      // already sent by this point. Logged, and swallowed.
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const { activateReferralOnFirstQuote } = await import("@/lib/referral-activation");
        const result = await activateReferralOnFirstQuote(createAdminClient(), {
          refereeContractorId: job.contractor_id,
          jobId,
        });
        if (result.activated) {
          console.log(
            `[referral_activated_on_quote] referral=${result.referralId} free_jobs=${result.grantedFreeJobs} credit=${result.bankedCredit}`,
          );
        }
      } catch (err) {
        console.error("[referral_activation_failed]", err);
      }
    }

    // PFIX-4. The knowledge layer learns HERE, and nowhere earlier.
    //
    // It used to learn at draft time, before any human had seen the quote, and
    // again on every line edit. So the model's own invented figures were
    // embedded and came back as "similar past jobs" in the next draft's
    // prompt: the invention fed itself, and the pool grew with every draft.
    //
    // Sending is the first moment a contractor has stood behind the numbers.
    // A quote drafted and abandoned teaches nothing, which is the point — the
    // card is explicit that a quote never sent is not approval.
    //
    // `sendingLineItems` rather than a re-read: this is exactly what the
    // customer was told, including any edit made before sending.
    await syncQuoteKnowledge({
      contractorId: job.contractor_id,
      quoteId,
      jobType: job.extracted_json?.job_type,
      scopeItems: job.extracted_json?.scope_items,
      lineItems: sendingLineItems,
    });
    await rememberMaterialPrices(job.contractor_id, sendingLineItems);
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
    .select("id, work_completed_at, quotes(contracts(status, signed_at))")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) return { error: "Job not found" };

  // IS ANY CONTRACT ON THIS JOB SIGNED? That is the question, and it was being
  // asked as "what is THE contract, and is it signed".
  //
  // `contracts` off a quote was a to-one OBJECT while `contracts.quote_id` was
  // UNIQUE. Migration 83 replaced that constraint with a partial unique index,
  // and PostgREST decides to-one versus to-many from exactly that constraint —
  // so it is an ARRAY now. `embeddedOne` reads both shapes, but on an array it
  // returns `value[0]` in UNSPECIFIED order, and this select has no ORDER BY.
  //
  // On a job with three contracts — two withdrawn and the signed one, which is
  // the ordinary shape after a re-issue — `[0]` was usually a dead contract, so
  // the guard refused a job whose contract was signed, invoiced and paid.
  // Reported 18 Sep against three jobs on the dashboard, every attempt failing.
  //
  // Asked correctly it needs no ordering at all: a signed contract authorises
  // completion whatever else happened, and `withdrawContract` refuses to
  // withdraw a signed contract, so a signature cannot later become stale.
  // `quotes` off a job is genuinely an array, so flatten that too rather than
  // taking `[0]` and hoping.
  const quotes = (job.quotes ?? []) as unknown as {
    contracts: Embedded<{ status: string; signed_at: string | null }>;
  }[];
  const signed = quotes
    .flatMap((quote) => embeddedMany(quote?.contracts))
    .some((contract) => contract?.status === "signed");

  // Refuse to mark complete unless a contract is signed. Undoing (complete =
  // false) has no such guard — a misfire must be reversible even if the
  // contract is unsigned or absent.
  if (complete && !signed) {
    return { error: "Work can only be marked complete after the contract is signed." };
  }

  // Idempotent: if already marked complete, return success without changing
  // the timestamp. This preserves the historical record — the timestamp
  // captures when work was first marked complete, not when the button was
  // last tapped.
  if (complete && job.work_completed_at) {
    return { success: true };
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

const markStageCompleteSchema = z.object({
  jobId: z.string().uuid(),
  stageNumber: z.number().int().positive(),
});

/**
 * The second trigger: a stage's WORK is done, so its invoice goes out.
 *
 * Distinct from `markWorkComplete` above, which is about the whole job. A
 * staged job is worked, invoiced and settled one stage at a time, and
 * `payment_stages` already carries `settled_at` for the last of those three.
 * Migration 81 adds `work_completed_at` for the first. Conflating them is how
 * a job with a settled deposit came to show every milestone ticked (#739).
 *
 * EXACTLY ONCE, BY THE UPDATE RATHER THAN BY A READ.
 *
 * The `.is("work_completed_at", null)` condition IS the guard: two concurrent
 * calls both attempt it, one matches the row and one matches nothing, and only
 * the winner reaches `createInvoiceRecord`. Reading first and then writing
 * would leave a window between the two — the same shape `signContract`'s
 * `.eq("status", "sent")` guard exists to close.
 *
 * `createInvoiceRecord` carries its own idempotency guard on top (an invoice
 * for the same quote, type and amount is reused rather than raised twice), so
 * a stage whose invoice somehow exists already does not produce a second.
 *
 * THE INVOICE TYPE IS `deposit` OR `final`, NEVER `stage`.
 *
 * `invoices.invoice_type` is free text with no CHECK, so "stage" would store —
 * and `deriveSituation` and `deriveStages` both branch on
 * `invoice_type === "deposit"` versus not, so a "stage" value would silently
 * count stage 1 of 2 as a CLOSING invoice and tick Invoiced and Paid on a
 * half-paid job. That is exactly the defect #739 fixed. `createPaymentStages`
 * produces two stages, so stage 1 is the deposit and the last is the final,
 * which the existing vocabulary already describes correctly.
 */
export const markStageComplete = async (
  input: z.infer<typeof markStageCompleteSchema>,
): Promise<{ success: true; invoiceRaised: boolean } | { error: string }> => {
  const { jobId, stageNumber } = markStageCompleteSchema.parse(input);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Read for the two answers the UPDATE cannot give: whether the stage exists
  // at all, and how many stages there are (which decides the invoice type).
  // Neither is a guard — the guard is the conditional UPDATE below.
  const { data: stages, error: stagesError } = await supabase
    .from("payment_stages")
    .select("id, stage_number, amount_pennies, invoice_id, work_completed_at")
    .eq("job_id", jobId)
    .order("stage_number");

  if (stagesError) return { error: stagesError.message };
  const stage = (stages ?? []).find((s) => s.stage_number === stageNumber);
  if (!stage) return { error: "That payment stage doesn't exist on this job." };

  const { data: claimed, error: claimError } = await supabase
    .from("payment_stages")
    .update({ work_completed_at: new Date().toISOString() })
    .eq("id", stage.id)
    .is("work_completed_at", null)
    .select("id, amount_pennies");

  if (claimError) return { error: claimError.message };

  // Matched no row: another request won, or this stage was already marked.
  // Idempotent — the caller asked for it to be complete and it is.
  if (!claimed || claimed.length === 0) {
    return { success: true, invoiceRaised: false };
  }

  // Already invoiced by another path (the dashboard raises invoices against
  // stages too). Completion is recorded; nothing more to raise.
  if (stage.invoice_id) return { success: true, invoiceRaised: false };

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, customer:customers(name, contact), contractor:contractors(company_name, payout_details_complete), quotes(id)",
    )
    .eq("id", jobId)
    .maybeSingle();

  const quote = embeddedOne(
    (job as unknown as { quotes: Embedded<{ id: string }> } | null)?.quotes,
  );
  const contractor = embeddedOne(
    (job as unknown as {
      contractor: Embedded<{ company_name: string; payout_details_complete: boolean }>;
    } | null)?.contractor,
  );
  const customer = embeddedOne(
    (job as unknown as {
      customer: Embedded<{
        name: string;
        contact: { email?: string; phone?: string; sms_opt_out?: boolean } | null;
      }>;
    } | null)?.customer,
  );

  if (!quote || !contractor) {
    // The completion is recorded and correct; only the invoice could not be
    // raised. Say so rather than reporting a plain success the contractor
    // would read as "the customer has been asked for the money".
    return { error: "Stage marked complete, but the invoice couldn't be raised — no quote found." };
  }

  const lastStageNumber = Math.max(...(stages ?? []).map((s) => s.stage_number));

  await createInvoiceRecord(supabase, {
    quoteId: quote.id,
    invoiceType: stageNumber === lastStageNumber ? "final" : "deposit",
    amount: claimed[0].amount_pennies / 100,
    companyName: contractor.company_name,
    customerName: customer?.name ?? "Customer",
    customerEmail: customer?.contact?.email,
    customerPhone: customer?.contact?.phone,
    customerSmsOptOut: customer?.contact?.sms_opt_out === true,
    payoutDetailsComplete: contractor.payout_details_complete,
    paymentStageId: stage.id,
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath("/dashboard");

  return { success: true, invoiceRaised: true };
};

const withdrawContractSchema = z.object({
  contractId: z.string().uuid(),
});

/**
 * Withdraws a sent contract before the customer signs it. Allows the contractor
 * to stop a contract with incorrect terms from being signed.
 *
 * - Verifies the contract is sent but not signed
 * - Refuses if the contract is already signed (throws an error)
 * - Updates contracts.status to "withdrawn"
 * - Revalidates relevant paths
 * - Does NOT trigger any customer notifications
 *
 * After withdrawal, the quote becomes editable again and the job returns to
 * "Accepted — need contract" state, allowing the contractor to send a corrected
 * contract.
 */
export const withdrawContract = async (
  contractId: string,
): Promise<{ success: boolean }> => {
  const supabase = await createClient();

  // Unconditional. A guard that skips itself when `auth` is absent is shaped by
  // the test rather than by the requirement — and the shape of the client is
  // not something this action should be deciding anything from.
  //
  // RLS is the real gate: `contracts` is owner-scoped via quote -> job ->
  // contractor -> auth.uid() (migration 20, `for all`), so a withdrawal of
  // someone else's contract matches no row whatever this check does. That is
  // belt and braces, and belt and braces is worth having on a write that voids
  // an agreement.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Read the contract to check its current status
  // We need the job_id for revalidation, which comes through quote in production
  // but may be directly on the mock in tests
  const { data: contract, error: fetchError } = await supabase
    .from("contracts")
    .select("id, status, quote_id, quote:quotes(job_id)")
    .eq("id", contractId)
    .maybeSingle();

  if (fetchError || !contract) throw new Error("Contract not found");

  // Verify ownership through the job's contractor_id - in production this is
  // enforced by RLS, in tests it's assumed based on the mocked data
  const contractData = contract as unknown as {
    id: string;
    status: string;
    quote_id: string;
    quote?: { job_id: string } | null;
    job_id?: string; // Test mocks may include this directly
  };

  // Get job_id from the nested quote (production) or directly from the contract (test mock)
  // In tests, this may be unavailable if the mock doesn't include it
  const jobId = contractData.quote?.job_id ?? contractData.job_id;

  // Refuse if the contract is already signed
  if (contractData.status === "signed") {
    throw new Error(
      "This contract has already been signed and cannot be withdrawn. " +
        "To make changes, you'll need to raise a variation or a new quote.",
    );
  }

  // Refuse if the contract is already withdrawn
  if (contractData.status === "withdrawn") {
    throw new Error("This contract has already been withdrawn.");
  }

  // Update the contract status to withdrawn
  const { error: updateError } = await supabase
    .from("contracts")
    // `withdrawn_at` (migration 82). CONTRACT-1 shipped withdrawal with no
    // timestamp, on a decision that the dashboard's contract list did not need
    // one — right about the list, wrong about the Activity panel, which nothing
    // considered. buildTimeline is a projection of row state, so an event with
    // no recorded moment cannot appear at all.
    .update({ status: "withdrawn", withdrawn_at: new Date().toISOString() })
    .eq("id", contractId)
    .eq("status", "sent"); // Guard against race condition

  if (updateError) {
    throw new Error(updateError.message);
  }

  // Revalidate relevant paths
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
  }
  revalidatePath(`/c/${contractId}`);

  return { success: true };
};
