import Anthropic from "@anthropic-ai/sdk";
import { quoteDraftSchema, type JobExtraction, type QuoteDraft } from "@/lib/schemas/job";
import { sowDeltaSchema, mergeSowDelta, type SowState, type SowTurn } from "@/lib/schemas/sow";

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const extractJson = (text: string): unknown => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Claude response");
  try {
    return JSON.parse(match[0]);
  } catch {
    throw new Error(
      "Claude response was not valid JSON — it may have been cut off. Try again.",
    );
  }
};

// Advances a multi-turn Statement of Work conversation. The model is only
// asked for what's NEW or CHANGED in the contractor's latest message — not
// the full accumulated state — which keeps output size (and turnaround
// latency) roughly constant no matter how long the conversation gets.
// `mergeSowDelta` deterministically folds that delta into the running state.
// The caller enforces a hard cap on turns — this only proposes.
export const advanceSow = async (
  conversation: SowTurn[],
  currentState: SowState | null,
): Promise<SowState> => {
  const message = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "You are helping a UK tradesperson build a Statement of Work (SoW) through a short back-and-forth " +
      "voice conversation. You're given the full conversation so far and the state already captured. " +
      "Report ONLY what is new or changed in the contractor's LATEST message — do not repeat rooms, " +
      "materials, or assumptions already present in current_state unless something about them changed " +
      "this turn (e.g. a room's dimensions were corrected, or a new work item was added to a room already " +
      "listed). For a room already in current_state, only include the work_items being ADDED to it, not " +
      "ones already listed. Omit job_type, access_issues, and timeline entirely (or set null) unless newly " +
      "established or corrected this turn. " +
      "Then decide: is there enough information to draft an accurate quote? If yes, set complete:true and " +
      "next_question:null. If not, set complete:false and next_question to ONE short, specific follow-up " +
      "question — but only ask if the answer would genuinely change the price or scope. A good estimator " +
      "infers the rest rather than interrogating. Never plan for more than 5 questions total. " +
      "Respond with ONLY a JSON object, no prose: " +
      '{"job_type": string?, "rooms": [{"name": string, "dimensions": string?, "work_items": string[]}], ' +
      '"materials_mentioned": string[], "access_issues": string?, "timeline": string?, ' +
      '"assumptions": string[], "complete": boolean, "next_question": string?}',
    messages: [
      {
        role: "user",
        content: JSON.stringify({ conversation, current_state: currentState }),
      },
    ],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const delta = sowDeltaSchema.parse(extractJson(text));
  return mergeSowDelta(currentState, delta);
};

export type ContractorContext = {
  trade: string | null;
  day_rate: number | null;
  overtime_rate: number | null;
  callout_min: number | null;
  travel_rate: number | null;
  markup_pct: number | null;
  team_members: { name: string; role: string | null; day_rate: number | null }[];
  similar_past_jobs?: string[];
  known_material_prices?: { description: string; unit: string | null; unit_price: number }[];
  rate_cards?: {
    work_type: string;
    unit: string;
    rate_per_unit: number;
    complexity_notes: string | null;
  }[];
};

export const draftQuoteLineItems = async (
  extraction: JobExtraction,
  contractor: ContractorContext,
): Promise<QuoteDraft> => {
  const message = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You propose line items for a UK tradesperson's quote, based on the job details and the contractor's " +
      "known rates. You do NOT calculate totals — the app does that in code. For any quantity or price you " +
      "cannot know for certain (e.g. labour days, material quantities), set assumed:true and explain in " +
      "assumption_note. Never invent a day rate — use the contractor's rates provided. " +
      "If similar_past_jobs are provided, use them as reference for realistic quantities and pricing on " +
      "comparable work, but always prioritise this job's own details. " +
      "If known_material_prices are provided and a material in this job matches one, use that exact " +
      "unit_price and set assumed:false — the contractor has already confirmed that price. " +
      "If rate_cards are provided and a work item in this job matches one (by work_type), use that " +
      "exact rate_per_unit and unit, and set assumed:false — this is the contractor's confirmed rate " +
      "for that work, taking priority over any guessed labour rate. " +
      "The quantity and unit fields are the single source of truth for how much of something is being " +
      "charged — do not also restate a specific count (e.g. a number of days) in the description, since a " +
      "mismatch between the two would look like an error on the quote. Describe WHO/WHAT " +
      "(e.g. \"Labour – Mark (Owner/Plasterer)\") and let quantity/unit (e.g. 3 / day) carry the amount. " +
      "Respond with ONLY a JSON object: " +
      '{"line_items": [{"description": string, "category": "labour"|"materials"|"travel"|"callout"|"other", ' +
      '"quantity": number, "unit": string, "unit_price": number, "assumed": boolean, "assumption_note": string?}]}',
    messages: [
      {
        role: "user",
        content: JSON.stringify({ job: extraction, contractor }),
      },
    ],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return quoteDraftSchema.parse(extractJson(text));
};
