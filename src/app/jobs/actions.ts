"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio } from "@/lib/whisper";
import { synthesizeSpeech } from "@/lib/tts";
import { advanceSow, draftQuoteLineItems, generateSowNarrative } from "@/lib/claude";
import { computeQuoteTotals } from "@/lib/quote-math";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { customerInputSchema } from "@/lib/schemas/customer";
import { sowToExtraction, type SowState, type SowTurn } from "@/lib/schemas/sow";
import { sendQuoteEmail } from "@/lib/email";
import { renderQuotePdf } from "@/lib/pdf/render-quote";
import { findSimilarPastJobs, syncQuoteKnowledge } from "@/lib/knowledge";
import { findKnownMaterialPrices, rememberMaterialPrices } from "@/lib/materials";
import { z } from "zod";

const MAX_SOW_TURNS = 5;

const advanceSowConversationSchema = z.object({
  jobId: z.string().uuid().nullable(),
  storagePath: z.string(),
});

export type SowTurnResult = {
  jobId: string;
  complete: false;
  nextQuestion: string;
  questionAudio: string;
  sowState: SowState;
};

const GENERIC_OPENING_QUESTION =
  "Talk me through the job — rooms, work, and anything tricky about access.";

// Voices the opening prompt shown before the first recording, personalised
// to the contractor's own trade when known — so a plastering contractor is
// asked about "the plastering job" instead of a generic question that makes
// it look like the app has no memory of who they are. Called once on page
// load — kept separate from advanceSowConversation since there's no job yet
// at that point.
export const getGreeting = async (): Promise<{ question: string; audio: string }> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let trade: string | null = null;
  if (user) {
    const { data: contractor } = await supabase
      .from("contractors")
      .select("trade")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    trade = contractor?.trade ?? null;
  }

  const question = trade
    ? `Talk me through the ${trade.toLowerCase()} job — rooms, work, and anything tricky about access.`
    : GENERIC_OPENING_QUESTION;

  const audio = await synthesizeSpeech(question);
  return { question, audio };
};

// Advances the conversational Statement of Work by one voice turn: transcribes
// the latest recording, merges it into the running SoW state, and either asks
// one more targeted follow-up or — once complete — drafts the quote and
// redirects to the job page.
export const advanceSowConversation = async (
  input: z.infer<typeof advanceSowConversationSchema>,
): Promise<SowTurnResult> => {
  const { jobId, storagePath } = advanceSowConversationSchema.parse(input);
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

  let job: { id: string; conversation_json: SowTurn[]; sow_json: SowState | null };

  if (jobId) {
    const { data: existingJob, error } = await supabase
      .from("jobs")
      .select("id, conversation_json, sow_json")
      .eq("id", jobId)
      .eq("contractor_id", contractor.id)
      .single();
    if (error || !existingJob) throw new Error("Job not found");
    job = existingJob as typeof job;
  } else {
    const { data: newJob, error } = await supabase
      .from("jobs")
      .insert({ contractor_id: contractor.id, status: "sow_in_progress" })
      .select("id, conversation_json, sow_json")
      .single();
    if (error || !newJob) throw new Error(error?.message ?? "Failed to create job");
    job = newJob as typeof job;
  }

  const admin = createAdminClient();
  const { data: audioFile, error: downloadError } = await admin.storage
    .from("voice-notes")
    .download(storagePath);

  if (downloadError || !audioFile) {
    throw new Error(downloadError?.message ?? "Failed to download audio");
  }

  const transcript = await transcribeAudio(audioFile, storagePath.split("/").pop()!);

  const conversation: SowTurn[] = [
    ...job.conversation_json,
    { role: "contractor", text: transcript },
  ];

  // Only look up the contractor's own history on the first turn of a fresh
  // conversation — it's there to seed defaults (trade, typical materials)
  // so the model doesn't ask generic questions it could reasonably infer,
  // not something worth paying for on every turn.
  const isFirstTurn = !job.sow_json;
  const contractorContext = isFirstTurn
    ? {
        trade: contractor.trade,
        recentJobSummaries: contractor.trade
          ? await findSimilarPastJobs(contractor.id, contractor.trade)
          : [],
      }
    : undefined;

  let sowState = await advanceSow(conversation, job.sow_json, contractorContext);

  const contractorTurns = conversation.filter((turn) => turn.role === "contractor").length;
  if (contractorTurns >= MAX_SOW_TURNS) {
    sowState = { ...sowState, complete: true, next_question: undefined };
  }

  if (!sowState.complete) {
    const nextQuestion = sowState.next_question ?? "Anything else I should know?";
    const updatedConversation: SowTurn[] = [
      ...conversation,
      { role: "assistant", text: nextQuestion },
    ];

    // DB write and TTS synthesis are independent — run them together instead
    // of back-to-back to cut a full network round-trip off each turn.
    const [, questionAudio] = await Promise.all([
      supabase
        .from("jobs")
        .update({
          conversation_json: updatedConversation,
          sow_json: sowState,
          transcript,
        })
        .eq("id", job.id),
      synthesizeSpeech(nextQuestion),
    ]);

    return { jobId: job.id, complete: false, nextQuestion, questionAudio, sowState };
  }

  const preNarrativeExtraction = sowToExtraction(sowState);

  // These four lookups don't depend on each other — run them together rather
  // than serially, since each is its own network round-trip. The narrative
  // needs to be ready before we persist sow_json below, so it's generated
  // here too rather than tacked on afterwards as an extra sequential call.
  const [{ data: teamMembers }, { data: rateCards }, similarPastJobs, knownMaterialPrices, overviewNarrative] =
    await Promise.all([
      supabase
        .from("team_members")
        .select("name, role, day_rate")
        .eq("contractor_id", contractor.id),
      supabase
        .from("rate_cards")
        .select("work_type, unit, rate_per_unit, complexity_notes")
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
    ]);

  sowState = { ...sowState, overview_narrative: overviewNarrative };
  const extraction = sowToExtraction(sowState);

  await supabase
    .from("jobs")
    .update({
      conversation_json: conversation,
      sow_json: sowState,
      extracted_json: extraction,
      transcript,
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
  });

  const { total } = computeQuoteTotals(draft.line_items, contractor.vat_registered);

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      job_id: job.id,
      line_items_json: draft.line_items,
      total,
      status: "draft",
    })
    .select("id")
    .single();

  if (quoteError || !quote) throw new Error(quoteError?.message ?? "Failed to create quote");

  await supabase.from("jobs").update({ status: "drafted" }).eq("id", job.id);

  await syncQuoteKnowledge({
    contractorId: contractor.id,
    quoteId: quote.id,
    jobType: extraction.job_type,
    scopeItems: extraction.scope_items,
    lineItems: draft.line_items,
  });

  redirect(`/jobs/${job.id}`);
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
});

export const sendQuote = async (input: z.infer<typeof sendQuoteSchema>) => {
  const { jobId, quoteId, customer } = sendQuoteSchema.parse(input);
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("contractor_id, contractor:contractors(company_name)")
    .eq("id", jobId)
    .single();

  if (!job) throw new Error("Job not found");

  const { data: quote } = await supabase
    .from("quotes")
    .select("total")
    .eq("id", quoteId)
    .single();

  if (!quote) throw new Error("Quote not found");

  const { data: customerRow, error: customerError } = await supabase
    .from("customers")
    .insert({
      contractor_id: job.contractor_id,
      name: customer.name,
      contact: { email: customer.email },
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

  const companyName = (
    job.contractor as unknown as { company_name: string } | null
  )?.company_name ?? "Your contractor";

  const quoteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/q/${quoteId}`;

  // Best-effort — a PDF-render failure shouldn't block sending the quote.
  const pdfBuffer = await renderQuotePdf(quoteId).catch(() => null);

  const { delivered } = await sendQuoteEmail({
    to: customer.email,
    customerName: customer.name,
    companyName,
    quoteUrl,
    total: quote.total,
    pdfAttachment: pdfBuffer
      ? { filename: `quote-${quoteId}.pdf`, content: pdfBuffer }
      : undefined,
  });

  await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  return { delivered, quoteUrl };
};
