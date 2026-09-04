import { createAdminClient } from "@/lib/supabase/admin";

// Its OWN module, and for the reason src/lib/pricing-history.ts already
// documents about compile-draft: `@/lib/knowledge` is mocked WHOLESALE by
// frozen acceptance tests — tests/acceptance/quote-edit-status-guard.test.ts
// among them — so every export added to it breaks a partial mock that nothing
// downstream is permitted to repair.
//
// Learned the hard way: adding this function to knowledge.ts broke that exact
// test with "No countLearnedQuotes export is defined on the @/lib/knowledge
// mock". The file it broke was frozen, so the fix had to be here rather than
// there. Sitting apart is also the better home — this is a question ABOUT a
// contractor's history, asked by the pricing gate, not part of reading or
// writing the knowledge layer.

/**
 * How many PAST QUOTES this contractor has taught the knowledge layer.
 *
 * PFIX-4. The pricing-history gate used to be satisfied by anything
 * `findSimilarPastJobs` returned, and that retrieval has no source filter —
 * `match_knowledge_chunks` selects on contractor_id alone. So the single chunk
 * written by the business-setup interview came back as a "similar past job",
 * and a contractor who had done nothing but complete setup read as having
 * pricing history on their very first quote.
 *
 * A business-setup chunk does contain figures — it lists the day rate — which
 * is why sniffing the content for a price would not have worked either. The
 * day rate is deliberately NOT pricing history: it is what prices labour, and
 * it says nothing about what a bag of plaster costs.
 *
 * So the question is asked directly, by source type, rather than inferred from
 * what retrieval happened to rank. Cheap too: a count, with no embedding call.
 *
 * Fails to 0 — "no history" — which is the safe branch: material lines come
 * out flagged TBC rather than carrying a figure nobody stands behind.
 */
export const countLearnedQuotes = async (contractorId: string): Promise<number> => {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("knowledge_chunks")
      .select("id", { count: "exact", head: true })
      .eq("contractor_id", contractorId)
      .eq("source_type", "quote");

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
};
