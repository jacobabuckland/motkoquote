"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio } from "@/lib/whisper";
import { extractJobDetails, draftQuoteLineItems } from "@/lib/claude";
import { computeQuoteTotals } from "@/lib/quote-math";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { z } from "zod";

export const processVoiceNote = async (storagePath: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: contractor } = await supabase
    .from("contractors")
    .select(
      "id, trade, vat_registered, day_rate, overtime_rate, callout_min, travel_rate, markup_pct",
    )
    .eq("owner_user_id", user.id)
    .single();

  if (!contractor) throw new Error("No contractor profile — finish setup first");

  const { data: teamMembers } = await supabase
    .from("team_members")
    .select("name, role, day_rate")
    .eq("contractor_id", contractor.id);

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      contractor_id: contractor.id,
      source_audio_url: storagePath,
      status: "processing",
    })
    .select("id")
    .single();

  if (jobError || !job) throw new Error(jobError?.message ?? "Failed to create job");

  const admin = createAdminClient();
  const { data: audioFile, error: downloadError } = await admin.storage
    .from("voice-notes")
    .download(storagePath);

  if (downloadError || !audioFile) {
    throw new Error(downloadError?.message ?? "Failed to download audio");
  }

  const transcript = await transcribeAudio(audioFile, storagePath.split("/").pop()!);

  await supabase.from("jobs").update({ transcript }).eq("id", job.id);

  const extraction = await extractJobDetails(transcript);

  await supabase
    .from("jobs")
    .update({ extracted_json: extraction, status: "extracted" })
    .eq("id", job.id);

  const draft = await draftQuoteLineItems(extraction, {
    trade: contractor.trade,
    day_rate: contractor.day_rate,
    overtime_rate: contractor.overtime_rate,
    callout_min: contractor.callout_min,
    travel_rate: contractor.travel_rate,
    markup_pct: contractor.markup_pct,
    team_members: teamMembers ?? [],
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

  const { data: contractor } = await supabase
    .from("quotes")
    .select("job:jobs(contractor:contractors(vat_registered))")
    .eq("id", quoteId)
    .single();

  const vatRegistered = Boolean(
    (contractor as unknown as {
      job: { contractor: { vat_registered: boolean } };
    } | null)?.job?.contractor?.vat_registered,
  );

  const { total } = computeQuoteTotals(lineItems as LineItem[], vatRegistered);

  const { error } = await supabase
    .from("quotes")
    .update({ line_items_json: lineItems, total })
    .eq("id", quoteId);

  if (error) throw new Error(error.message);

  return { total };
};
