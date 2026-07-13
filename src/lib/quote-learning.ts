import type { LineItem } from "@/lib/schemas/job";
import { normalize } from "@/lib/rate-card-matching";
import { createAdminClient } from "@/lib/supabase/admin";

export type LineItemEditType = "modified" | "added" | "removed";

export type LineItemEdit = {
  description: string;
  normalized_description: string;
  category: string;
  edit_type: LineItemEditType;
  drafted_quantity: number | null;
  drafted_unit_price: number | null;
  drafted_multiplier: number | null;
  final_quantity: number | null;
  final_unit_price: number | null;
  final_multiplier: number | null;
};

const FLOAT_EPSILON = 0.001;
const differs = (a: number, b: number) => Math.abs(a - b) > FLOAT_EPSILON;

// Deterministically diffs the AI-drafted line items against what the
// contractor actually sent, matched by normalized description. This is the
// real signal for the learning loop — not the raw text of the quote, but
// specifically what the contractor corrected. Exact-match on normalized
// description (not token-overlap fuzzy matching) is deliberate: it's a
// conservative match that only compares items the contractor kept under
// (near enough) the same name, so a price/quantity/multiplier delta can be
// attributed with confidence rather than guessed from a fuzzy pairing.
export const diffLineItems = (drafted: LineItem[], final: LineItem[]): LineItemEdit[] => {
  const draftedByDesc = new Map(drafted.map((item) => [normalize(item.description), item]));
  const finalByDesc = new Map(final.map((item) => [normalize(item.description), item]));
  const edits: LineItemEdit[] = [];

  for (const [key, finalItem] of finalByDesc) {
    const draftedItem = draftedByDesc.get(key);
    if (!draftedItem) {
      edits.push({
        description: finalItem.description,
        normalized_description: key,
        category: finalItem.category,
        edit_type: "added",
        drafted_quantity: null,
        drafted_unit_price: null,
        drafted_multiplier: null,
        final_quantity: finalItem.quantity,
        final_unit_price: finalItem.unit_price,
        final_multiplier: finalItem.multiplier,
      });
      continue;
    }

    const changed =
      differs(draftedItem.quantity, finalItem.quantity) ||
      differs(draftedItem.unit_price, finalItem.unit_price) ||
      differs(draftedItem.multiplier, finalItem.multiplier);

    if (changed) {
      edits.push({
        description: finalItem.description,
        normalized_description: key,
        category: finalItem.category,
        edit_type: "modified",
        drafted_quantity: draftedItem.quantity,
        drafted_unit_price: draftedItem.unit_price,
        drafted_multiplier: draftedItem.multiplier,
        final_quantity: finalItem.quantity,
        final_unit_price: finalItem.unit_price,
        final_multiplier: finalItem.multiplier,
      });
    }
  }

  for (const [key, draftedItem] of draftedByDesc) {
    if (!finalByDesc.has(key)) {
      edits.push({
        description: draftedItem.description,
        normalized_description: key,
        category: draftedItem.category,
        edit_type: "removed",
        drafted_quantity: draftedItem.quantity,
        drafted_unit_price: draftedItem.unit_price,
        drafted_multiplier: draftedItem.multiplier,
        final_quantity: null,
        final_unit_price: null,
        final_multiplier: null,
      });
    }
  }

  return edits;
};

// Best-effort: persist a quote's edit diff. Never blocks the send flow —
// same convention as syncQuoteKnowledge in knowledge.ts.
export const recordQuoteEdits = async (
  contractorId: string,
  quoteId: string,
  edits: LineItemEdit[],
): Promise<void> => {
  if (edits.length === 0) return;
  try {
    const admin = createAdminClient();
    await admin.from("quote_line_edits").insert(
      edits.map((edit) => ({
        contractor_id: contractorId,
        quote_id: quoteId,
        description: edit.description,
        category: edit.category,
        edit_type: edit.edit_type,
        drafted_quantity: edit.drafted_quantity,
        drafted_unit_price: edit.drafted_unit_price,
        drafted_multiplier: edit.drafted_multiplier,
        final_quantity: edit.final_quantity,
        final_unit_price: edit.final_unit_price,
        final_multiplier: edit.final_multiplier,
      })),
    );
  } catch {
    // Edit-history recording is best-effort — never block sending the quote.
  }
};

const MIN_SAMPLE_SIZE = 2;
const MIN_PRICE_DELTA_PCT = 0.05;
const MAX_TENDENCIES = 5;

type StoredEdit = Pick<
  LineItemEdit,
  | "description"
  | "normalized_description"
  | "category"
  | "edit_type"
  | "drafted_unit_price"
  | "final_unit_price"
>;

type Tendency = { text: string; sampleSize: number };

// Turns a contractor's raw edit history into a handful of plain-English,
// prompt-ready statements — the actual "learning" step. Rather than handing
// the model a pile of past edits and hoping it spots the pattern itself,
// this computes the pattern deterministically (systematic price corrections
// by category, recurring items the contractor adds or strips out) and only
// surfaces a signal once it has recurred enough times to be a real pattern,
// not noise from a single edit.
export const summarizeTendencies = (edits: StoredEdit[]): string[] => {
  const tendencies: Tendency[] = [];

  const byCategory = new Map<string, { drafted: number; final: number }[]>();
  for (const edit of edits) {
    if (edit.edit_type !== "modified") continue;
    if (!edit.drafted_unit_price || edit.drafted_unit_price <= 0) continue;
    if (edit.final_unit_price === null) continue;
    const list = byCategory.get(edit.category) ?? [];
    list.push({ drafted: edit.drafted_unit_price, final: edit.final_unit_price });
    byCategory.set(edit.category, list);
  }
  for (const [category, pairs] of byCategory) {
    if (pairs.length < MIN_SAMPLE_SIZE) continue;
    const avgPct =
      pairs.reduce((sum, p) => sum + (p.final - p.drafted) / p.drafted, 0) / pairs.length;
    if (Math.abs(avgPct) < MIN_PRICE_DELTA_PCT) continue;
    const direction = avgPct > 0 ? "higher" : "lower";
    const pct = Math.round(Math.abs(avgPct) * 100);
    tendencies.push({
      text: `Across ${pairs.length} past quotes, this contractor typically prices "${category}" line items about ${pct}% ${direction} than the initial estimate — adjust accordingly.`,
      sampleSize: pairs.length,
    });
  }

  const countByDesc = (type: LineItemEditType) => {
    const counts = new Map<string, { description: string; count: number }>();
    for (const edit of edits) {
      if (edit.edit_type !== type) continue;
      const existing = counts.get(edit.normalized_description);
      if (existing) existing.count += 1;
      else counts.set(edit.normalized_description, { description: edit.description, count: 1 });
    }
    return counts;
  };

  for (const { description, count } of countByDesc("added").values()) {
    if (count < MIN_SAMPLE_SIZE) continue;
    tendencies.push({
      text: `This contractor has added a "${description}" line item that wasn't in the initial draft on ${count} past quotes — consider including it upfront.`,
      sampleSize: count,
    });
  }

  for (const { description, count } of countByDesc("removed").values()) {
    if (count < MIN_SAMPLE_SIZE) continue;
    tendencies.push({
      text: `This contractor has removed the drafted "${description}" line item on ${count} past quotes — consider leaving it out unless clearly needed.`,
      sampleSize: count,
    });
  }

  return tendencies
    .sort((a, b) => b.sampleSize - a.sampleSize)
    .slice(0, MAX_TENDENCIES)
    .map((t) => t.text);
};

// Best-effort: fetch and summarize this contractor's edit history into
// prompt-ready tendency statements for the next quote draft.
export const getContractorTendencies = async (contractorId: string): Promise<string[]> => {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("quote_line_edits")
      .select("description, normalized_description, category, edit_type, drafted_unit_price, final_unit_price")
      .eq("contractor_id", contractorId)
      .limit(500);

    if (error || !data) return [];
    return summarizeTendencies(data as StoredEdit[]);
  } catch {
    return [];
  }
};
