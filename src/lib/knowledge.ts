import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";
import type { LineItem } from "@/lib/schemas/job";
import type { BusinessSetupState } from "@/lib/schemas/business-setup";

type SyncQuoteKnowledgeInput = {
  contractorId: string;
  quoteId: string;
  jobType?: string;
  scopeItems?: string[];
  lineItems: LineItem[];
};

const buildQuoteContent = (input: SyncQuoteKnowledgeInput): string => {
  const scope = input.scopeItems?.length ? input.scopeItems.join(", ") : "unspecified scope";
  const lines = input.lineItems
    .map(
      (item) =>
        `${item.description}: ${item.quantity} ${item.unit} @ £${item.unit_price} (${item.category})`,
    )
    .join("\n");
  return `Job type: ${input.jobType ?? "unspecified"}\nScope: ${scope}\nLine items:\n${lines}`;
};

// Best-effort: embed (or re-embed after an edit) a quote as a knowledge chunk so
// future drafts for this contractor can retrieve it as a similar past job.
export const syncQuoteKnowledge = async (input: SyncQuoteKnowledgeInput): Promise<void> => {
  try {
    const content = buildQuoteContent(input);
    const embedding = await embedText(content);
    const admin = createAdminClient();

    await admin
      .from("knowledge_chunks")
      .delete()
      .eq("contractor_id", input.contractorId)
      .eq("source_type", "quote")
      .eq("source_id", input.quoteId);

    await admin.from("knowledge_chunks").insert({
      contractor_id: input.contractorId,
      embedding,
      content,
      source_type: "quote",
      source_id: input.quoteId,
    });
  } catch {
    // Knowledge sync is best-effort — never block the quoting flow on it.
  }
};

export const findSimilarPastJobs = async (
  contractorId: string,
  queryText: string,
  limit = 3,
): Promise<string[]> => {
  try {
    const embedding = await embedText(queryText);
    const admin = createAdminClient();

    const { data, error } = await admin.rpc("match_knowledge_chunks", {
      p_contractor_id: contractorId,
      p_query_embedding: embedding,
      p_match_count: limit,
    });

    if (error || !data) return [];
    return (data as { content: string }[]).map((row) => row.content);
  } catch {
    return [];
  }
};

const buildBusinessSetupContent = (state: BusinessSetupState): string => {
  const rates = [
    state.day_rate ? `Day rate: £${state.day_rate}` : null,
    state.overtime_rate ? `Overtime rate: £${state.overtime_rate}` : null,
    state.callout_min ? `Call-out minimum: £${state.callout_min}` : null,
    state.travel_rate ? `Travel charge: £${state.travel_rate}` : null,
    state.markup_pct ? `Materials markup: ${state.markup_pct}%` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const profile = Object.entries(state.business_profile)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${value}`)
    .join(", ");

  return (
    `Business setup for ${state.company_name ?? "this contractor"}` +
    `${state.trade ? ` (${state.trade})` : ""}. ` +
    `${state.vat_registered === null ? "" : state.vat_registered ? "VAT registered. " : "Not VAT registered. "}` +
    `${rates ? `Rates: ${rates}. ` : ""}` +
    `${profile ? `Business profile: ${profile}.` : ""}`
  );
};

// Best-effort: embed the contractor's business setup (rates, VAT status,
// business profile) as a knowledge chunk so it's semantically retrievable
// via findSimilarPastJobs during future conversations (setup interviews and
// job intake alike) — match_knowledge_chunks doesn't filter by source_type,
// so anything synced here is automatically available as background context
// wherever the contractor's knowledge is queried.
export const syncBusinessSetupKnowledge = async (
  contractorId: string,
  state: BusinessSetupState,
): Promise<void> => {
  try {
    const admin = createAdminClient();
    const content = buildBusinessSetupContent(state);
    const embedding = await embedText(content);

    await admin
      .from("knowledge_chunks")
      .delete()
      .eq("contractor_id", contractorId)
      .eq("source_type", "business_setup")
      .eq("source_id", contractorId);

    await admin.from("knowledge_chunks").insert({
      contractor_id: contractorId,
      embedding,
      content,
      source_type: "business_setup",
      source_id: contractorId,
    });

    if (state.notes.length > 0) {
      const notesContent = `Notes from talking to ${state.company_name ?? "the contractor"}: ${state.notes.join(" | ")}`;
      const notesEmbedding = await embedText(notesContent);

      await admin
        .from("knowledge_chunks")
        .delete()
        .eq("contractor_id", contractorId)
        .eq("source_type", "setup_note")
        .eq("source_id", contractorId);

      await admin.from("knowledge_chunks").insert({
        contractor_id: contractorId,
        embedding: notesEmbedding,
        content: notesContent,
        source_type: "setup_note",
        source_id: contractorId,
      });
    }
  } catch {
    // Knowledge sync is best-effort — never block setup completion on it.
  }
};
