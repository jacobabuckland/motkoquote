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
  team_members: { id: string; name: string; role: string | null; day_rate: number | null }[];
  similar_past_jobs?: string[];
  known_material_prices?: { description: string; unit: string | null; unit_price: number }[];
  rate_cards?: {
    id: string;
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
      "You propose the STRUCTURE of line items for a UK tradesperson's quote, based on the job details and " +
      "the contractor's known rates. You NEVER set prices or totals — the app computes every amount in code " +
      "from the contractor's own confirmed numbers. Any price you were to invent would be discarded. Emit " +
      "one of four kinds of line, and NEVER silently drop a clearly-requested work item. " +
      "1) LABOUR — {kind:\"labour\", description, people:[{ref, days}], overtime?, includes_tasks?}. " +
      "`ref` is a team member's id from contractor.team_members, or the literal \"owner\" for the " +
      "contractor themselves. `days` is that person's number of days on this job. Emit ONE labour line for " +
      "the whole job covering the full crew and their days — e.g. owner 5 days + apprentice 5 days is " +
      "people:[{ref:\"owner\",days:5},{ref:\"<liam-id>\",days:5}]. Put the task breakdown (strip-out, " +
      "tiling, making good, ...) in includes_tasks as short strings WITHOUT their own days — never add a " +
      "second labour line for a task whose days are already inside the crew's total. Set overtime:true only " +
      "for work outside normal hours. Do NOT put a person's rate or a title anywhere — labels come from " +
      "team_members data. " +
      "2) MATERIAL — {kind:\"material\", description, quantity, unit, estimated_unit_cost_pence?, " +
      "supplied_by}. supplied_by is \"contractor\" or \"customer\". For customer-supplied items OMIT " +
      "estimated_unit_cost_pence — they price at £0 and are shown for scope only. For contractor-supplied " +
      "items give your best estimated_unit_cost_pence (pence, per unit); the app applies the contractor's " +
      "markup in code. Use job.materials_supply to decide who supplies what. " +
      "3) RATE_CARD — {kind:\"rate_card\", rate_card_id, quantity, description}. When a work item matches " +
      "one of contractor.rate_cards, reference it by its id — the app fills in the exact rate. Match " +
      "generously on meaning, not just wording (e.g. a \"heated towel rail swap\" matches a \"radiator " +
      "swap\" card). NO price. " +
      "4) PROVISIONAL — {kind:\"provisional\", description, suggested_amount_pence, reason}. For work whose " +
      "cost can't be known yet (e.g. a soil stack whose condition is unknown until opened) — a clearly " +
      "editable placeholder amount with a short reason. " +
      "If similar_past_jobs are provided, use them as reference for realistic quantities and days on " +
      "comparable work, but always prioritise this job's own details. " +
      "If known_material_prices are provided they are contractor-confirmed — you still just estimate; the " +
      "app will substitute the confirmed price. " +
      "If contractor_tendencies are provided, they are learned corrections from this contractor's own past " +
      "edits — apply them proactively (e.g. include or omit a line item they consistently add or strip). " +
      "Respond with ONLY a JSON object: {\"line_items\": [ <one of the four line shapes above>, ... ]}.",
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
