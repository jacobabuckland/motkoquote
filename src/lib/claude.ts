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

// Context about the contractor's own history, used only to seed the very
// first turn of a conversation — so the model can default the trade and
// typical materials instead of asking as if it's never met this contractor
// before. Not re-sent on later turns since job_type, once set, persists in
// currentState.
export type SowContractorContext = {
  trade: string | null;
  recentJobSummaries: string[];
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
  contractorContext?: SowContractorContext,
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
      "If contractor_context is provided and current_state.job_type is empty, default job_type to " +
      "contractor_context.trade instead of asking what trade this job is — add one assumption noting the " +
      "default in plain language (e.g. \"Assumed this is a plastering job based on your recent work — say " +
      "if it's something else\"). If contractor_context.recent_job_summaries are provided, use them only " +
      "as soft background for typical materials/methods on this contractor's usual work — never invent a " +
      "room, work item, or material the contractor hasn't actually mentioned this conversation. " +
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
        content: JSON.stringify({
          conversation,
          current_state: currentState,
          contractor_context: contractorContext
            ? { trade: contractorContext.trade, recent_job_summaries: contractorContext.recentJobSummaries }
            : undefined,
        }),
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

// Writes a short, human-readable Overview paragraph for the completed SoW,
// once — not per turn. Grounded strictly in the structured sow data (no new
// facts invented); the assumptions are restated as prose so the customer
// sees them, not just a bullet fragment.
export const generateSowNarrative = async (
  sow: SowState,
  contractor: { trade: string | null; companyName: string },
): Promise<string> => {
  const message = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system:
      "You write a short, professional Overview paragraph (3-5 sentences) for a UK tradesperson's " +
      "Statement of Work, to be read by their customer. Base it STRICTLY on the structured job data " +
      "provided — do not invent rooms, work, materials, or assumptions not present in the data. " +
      "Summarise what work is being done and where, in plain language a homeowner would understand, " +
      "then note (in the same paragraph or a short second one) any assumptions being made and that " +
      "they should be confirmed before work starts. Do not repeat every bullet verbatim — synthesise. " +
      "Respond with ONLY the paragraph text — no heading, no JSON, no quotation marks.",
    messages: [
      {
        role: "user",
        content: JSON.stringify({ sow, contractor }),
      },
    ],
  });

  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
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
