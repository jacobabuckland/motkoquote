import Anthropic from "@anthropic-ai/sdk";
import { quoteDraftSchema, type JobExtraction, type QuoteDraft } from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";

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
  // Deterministically computed from this contractor's past edit history
  // (see quote-learning.ts) — plain-English corrections the contractor has
  // made repeatedly, e.g. systematic price adjustments by category or line
  // items they consistently add or strip out. Distinct from
  // similar_past_jobs: this is the model told what to do, not raw examples
  // to infer a pattern from itself.
  contractor_tendencies?: string[];
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
      "Use multiplier (default 1) instead of inflating unit_price when a job detail genuinely changes the " +
      "rate for a line — e.g. 1.5 for difficult/restricted access, out-of-hours work, or working at height — " +
      "and explain the adjustment in assumption_note. Leave it at 1 for ordinary work. " +
      "If contractor_tendencies are provided, they are learned corrections from this contractor's own past " +
      "edits — apply them proactively rather than waiting to be corrected again (e.g. if it says they " +
      "price a category higher than the initial estimate, price accordingly; if it says they add or remove " +
      "a specific line item, do the same here). " +
      "Respond with ONLY a JSON object: " +
      '{"line_items": [{"description": string, "category": "labour"|"materials"|"travel"|"callout"|"other", ' +
      '"quantity": number, "unit": string, "unit_price": number, "multiplier": number, "assumed": boolean, ' +
      '"assumption_note": string?}]}',
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
