"use server";

import { createClient } from "@/lib/supabase/server";
import { createRealtimeClientSecret, type RealtimeToolDef } from "@/lib/realtime";
import { generateSowNarrative, draftQuoteLineItems } from "@/lib/claude";
import { computeQuoteTotals } from "@/lib/quote-math";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { customerInputSchema } from "@/lib/schemas/customer";
import {
  sowToExtraction,
  mergeSowToolDelta,
  SOW_DELTA_TOOL_PARAMETERS,
  EMPTY_SOW_STATE,
  type SowState,
  type WrapReason,
} from "@/lib/schemas/sow";
import { sendQuoteEmail } from "@/lib/email";
import { sendQuoteSms } from "@/lib/sms";
import { normalizeUkPhone } from "@/lib/phone";
import { renderQuotePdf } from "@/lib/pdf/render-quote";
import { findSimilarPastJobs, syncQuoteKnowledge } from "@/lib/knowledge";
import { findKnownMaterialPrices, rememberMaterialPrices } from "@/lib/materials";
import { compileDraftToLineItems } from "@/lib/compile-draft";
import { applyAgreedDayRate, applyAgreedFixedPrice } from "@/lib/agreed-costs";
import { usedGenericFallback } from "@/lib/question-packs/fallback";
import { diffLineItems, getContractorTendencies, recordQuoteEdits } from "@/lib/quote-learning";
import { track } from "@/lib/analytics";
import { z } from "zod";

const MAX_SOW_TURNS = 5;

const REALTIME_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "update_sow",
    description:
      "Call after the contractor mentions any room, work item, material, access issue, timeline, or the " +
      "trade/job type — even partial info. Only include what's new or changed since your last call.",
    parameters: SOW_DELTA_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "finish_job",
    description:
      "Call once you have enough information to draft an accurate quote, or once 5 questions have been asked.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "wrap_up",
    description:
      "Call to END the whole call cleanly once there's nothing left worth asking, or the contractor " +
      "signals they're finished (e.g. 'that's it', 'that's everything', 'we're done'). Say ONE short " +
      "closing sentence first — noting anything still unknown will be flagged as an assumption — then " +
      "call this. This concludes the conversation and drafts the quote; do not keep asking after it.",
    parameters: { type: "object", properties: {}, required: [] },
  },
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
    .select("id, trade")
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

  const tradeLine = contractor.trade
    ? `Default to assuming this is a ${contractor.trade.toLowerCase()} job unless they say otherwise — ` +
      "don't ask what trade it is. "
    : "";
  const historyLine =
    contractorKnowledge.length > 0
      ? `Known context about this contractor: ${contractorKnowledge.join(" | ")}. Use this only as soft ` +
        "background — typical materials/methods on their usual work, standing rates or preferences from " +
        "setup — never invent a room, work item, or material they haven't actually mentioned this " +
        "conversation. "
      : "";

  const correctionLine =
    "If the contractor corrects or retracts something they said earlier (e.g. 'actually, scrap that — " +
    "it's ten, not fourteen'), do NOT just add the corrected fact alongside the old one. Call update_sow " +
    "again for that room with removed_work_items set to the original wording you used when you first " +
    "reported it, and work_items set to the corrected fact. Example: you earlier called update_sow with " +
    "room 'Downstairs', work_items: ['fourteen double sockets']; the contractor then says 'actually, " +
    "scrap that — it's ten, four in the kitchen are staying' — call update_sow again with room " +
    "'Downstairs', removed_work_items: ['fourteen double sockets'], work_items: ['ten double sockets, " +
    "four in the kitchen excluded']. The same last-value-wins logic applies to any other fact they " +
    "correct — always report the new value, never leave the contradiction unresolved. ";

  const taxonomyLine =
    "File facts into the right field: access_issues is about constraints on HOW/WHEN the work can happen " +
    "(occupancy, working hours, parking, keys) — existing_conditions is about the STATE of the current " +
    "installation or fabric (e.g. 'old rubber cable throughout'), never mix the two. If they mention how " +
    "many people and how long the job will take, call update_sow with labour_plan. If they mention a " +
    "deadline, distinguish quote_by (when the quote itself is needed) from job_by (when the work must be " +
    "done). Capture explicit in-scope items as inclusions and explicit out-of-scope items as exclusions " +
    "(e.g. 'kitchen sockets staying', 'decorating by customer'). Anything they say they couldn't verify or " +
    "might need to revisit goes in assumptions_and_unknowns with a treatment: 'excluded' if it's out of " +
    "scope entirely, 'provisional_sum' if it may need a separate quote later, 'assumed_ok' if the quote " +
    "assumes it's fine and only needs flagging. Only set access_issues, existing_conditions, or any other " +
    "optional field if the contractor actually said something relevant — never fill one in with 'none', " +
    "'no issues', or similar placeholder text just because the field exists; leave it unset instead. When " +
    "you report materials_mentioned, write each one properly capitalised and as it would read in a written " +
    "document (e.g. 'Multi-finish plaster', not 'multi finish plaster'). ";

  const checklistCaptureLine =
    "If, while describing the job, the contractor volunteers any of the following without being asked — " +
    "who else will be on site (labour_plan.crew_description), how many days or which days the job will " +
    "take (labour_plan.duration_days), which materials they vs the customer are supplying " +
    "(materials_supply), when the customer needs it done by (deadline.job_by), or any day rate/fixed " +
    "price/deposit already agreed with the customer (agreed_costs) — capture it immediately via " +
    "update_sow. Do not proactively ask about any of these five yourself; a separate short follow-up " +
    "step after this conversation will ask only whichever of them the contractor hasn't already covered. ";

  const customerLine =
    "A quote can't be sent without knowing who it's for — before you call finish_job, make sure you have " +
    "captured the customer's name and site address, and at least one way to reach them (phone or email), " +
    "calling update_sow with customer_name/site_address/customer_phone/customer_email as soon as the " +
    "contractor mentions any of them. If the call is wrapping up and any of these are still missing, ask " +
    "for them directly as your final question(s) — this doesn't count against the price/scope question " +
    "budget below, since it's required to send the quote, not to price the job. ";

  const instructions =
    "You are a UK tradesperson's assistant, having a brief live spoken conversation with the contractor " +
    "themselves (not the customer) to build a Statement of Work for a job they're about to quote. Speak " +
    "naturally and briefly — this is a voice conversation, not a form. Start by asking them to talk you " +
    "through the job: rooms, work, and anything tricky about access. " +
    tradeLine +
    historyLine +
    "After anything they say that adds or changes a room, work item, material, access issue, or timeline, " +
    "call the update_sow tool with ONLY what's new or changed — never repeat information already captured. " +
    correctionLine +
    taxonomyLine +
    checklistCaptureLine +
    customerLine +
    "Ask at most one short, specific follow-up question at a time, and only if the answer would genuinely " +
    "change the price or scope — a good estimator infers the rest rather than interrogating. Never ask " +
    `more than ${MAX_SOW_TURNS} questions total. Once you have enough information to draft an accurate ` +
    `quote, or after ${MAX_SOW_TURNS} questions, call the finish_job tool and tell them you've got what ` +
    "you need. " +
    "The moment the contractor signals they're finished — 'that's it', 'that's everything', 'we're done', " +
    "'nothing else' — do NOT keep asking: say one short closing sentence (noting anything still unknown " +
    "will be flagged as an assumption to confirm) and call the wrap_up tool to end the call. Also call " +
    "wrap_up, rather than looping, whenever there is genuinely nothing left worth asking — never leave the " +
    "contractor waiting on you to conclude.";

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
  // How the live intake concluded, for the voice_session_completed event —
  // see WrapReason. Optional so the manual/typed fallbacks that don't run a
  // live call don't have to fabricate one.
  wrapReason: z
    .enum(["slots", "user", "cap_questions", "cap_time", "manual"])
    .optional(),
  questionsAsked: z.number().int().nonnegative().optional(),
});

// Runs once the live conversation ends — either the model called finish_job,
// or the client hit the turn cap. Drafts the quote from whatever SoW state
// was accumulated via saveSowDelta during the call, same as the old
// end-of-conversation branch did. Does not redirect — the client tears down
// the WebRTC connection first, then navigates using the returned jobId.
export const completeSowConversation = async (
  input: z.infer<typeof completeSowSchema>,
): Promise<{ jobId: string }> => {
  const { jobId, transcript, wrapReason, questionsAsked } = completeSowSchema.parse(input);
  const supabase = await createClient();

  // Loop-regression telemetry (Task 3): a healthy live intake concludes on
  // 'slots'/'user'/'manual'; a spike in 'cap_questions'/'cap_time' means the
  // model is failing to wrap up on its own and the hard safety net is ending
  // the call instead. Only logged when the caller ran a live call.
  if (wrapReason) {
    await track("voice_session_completed", {
      wrap_reason: wrapReason,
      questions_asked: questionsAsked ?? null,
    });
  }
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
  sowState = {
    ...sowState,
    complete: true,
    next_question: undefined,
    used_generic_fallback: usedGenericFallback(sowState.job_type),
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
  const lineItems = applyAgreedFixedPrice(dayRatedItems, sowState.agreed_costs?.fixed_price);

  const { total } = computeQuoteTotals(lineItems, contractor.vat_registered);

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      job_id: job.id,
      line_items_json: lineItems,
      // Immutable baseline for the learning loop (see quote-learning.ts) —
      // this is what the contractor actually saw first, before any of their
      // own edits, distinct from line_items_json which mutates on save.
      drafted_line_items_json: lineItems,
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
    lineItems,
  });

  return { jobId: job.id };
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
      "job:jobs(extracted_json, contractor:contractors(id, vat_registered))",
    )
    .eq("id", quoteId)
    .single();

  const job = (quoteContext as unknown as {
    job: {
      extracted_json: { job_type?: string; scope_items?: string[] } | null;
      contractor: { id: string; vat_registered: boolean };
    };
  } | null)?.job;

  const vatRegistered = Boolean(job?.contractor?.vat_registered);

  const { total } = computeQuoteTotals(lineItems as LineItem[], vatRegistered);

  const { error } = await supabase
    .from("quotes")
    .update({ line_items_json: lineItems, total })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

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
  // Which channels to attempt — defaults to "whatever contact info is
  // present" so existing callers (and the email-only original flow) keep
  // working without passing this explicitly.
  channels: z
    .object({ email: z.boolean().default(true), sms: z.boolean().default(true) })
    .default({ email: true, sms: true }),
});

export const sendQuote = async (input: z.infer<typeof sendQuoteSchema>) => {
  const { jobId, quoteId, customer, channels } = sendQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("contractor_id, customer_id, contractor:contractors(company_name)")
    .eq("id", jobId)
    .single();

  if (!job) throw new Error("Job not found");

  const { data: quote } = await supabase
    .from("quotes")
    .select("total, line_items_json, drafted_line_items_json")
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  // Learning loop: this is the moment of truth — what the contractor is
  // actually sending vs what was first drafted for them. Recorded once here
  // (not on every intermediate "Save changes") so it reflects their real,
  // final correction rather than in-progress keystrokes.
  if (quote.drafted_line_items_json) {
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

  // Best-effort — a PDF-render failure shouldn't block sending the quote.
  const pdfBuffer = await renderQuotePdf(quoteId).catch(() => null);

  // Each channel is only attempted if the contractor selected it, the
  // relevant contact detail is present, and (for SMS) the customer hasn't
  // opted out. Independent of each other — a missing/failed email should
  // never block SMS delivery, and vice versa.
  const emailAttempted = channels.email && Boolean(customer.email);
  const smsAttempted = channels.sms && Boolean(normalizedPhone) && !customer.smsOptOut;

  const [emailResult, smsResult] = await Promise.all([
    emailAttempted
      ? sendQuoteEmail({
          to: customer.email!,
          customerName: customer.name,
          companyName,
          quoteUrl,
          total: quote.total,
          pdfAttachment: pdfBuffer
            ? { filename: `quote-${quoteId}.pdf`, content: pdfBuffer }
            : undefined,
        })
      : Promise.resolve({ delivered: false }),
    smsAttempted
      ? sendQuoteSms({
          to: normalizedPhone!,
          companyName,
          total: quote.total,
          quoteUrl,
        })
      : Promise.resolve({ delivered: false }),
  ]);

  await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  await track("quote_sent", { quote_id: quoteId });

  return {
    delivered: emailResult.delivered || smsResult.delivered,
    email: { attempted: emailAttempted, delivered: emailResult.delivered },
    sms: { attempted: smsAttempted, delivered: smsResult.delivered },
    quoteUrl,
  };
};
