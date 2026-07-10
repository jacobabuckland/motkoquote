import { createAdminClient } from "@/lib/supabase/admin";
import { embedText } from "@/lib/embeddings";
import type { LineItem } from "@/lib/schemas/job";

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
