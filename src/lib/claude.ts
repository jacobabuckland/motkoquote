import Anthropic from "@anthropic-ai/sdk";
import {
  jobExtractionSchema,
  quoteDraftSchema,
  type JobExtraction,
  type QuoteDraft,
} from "@/lib/schemas/job";

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const extractJson = (text: string): unknown => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON object found in Claude response");
  return JSON.parse(match[0]);
};

export const extractJobDetails = async (
  transcript: string,
): Promise<JobExtraction> => {
  const message = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "You extract structured job details from a UK tradesperson's site-visit voice note transcript. " +
      "Respond with ONLY a JSON object matching this shape, no prose: " +
      '{"job_type": string, "scope_items": string[], "dimensions": string?, ' +
      '"materials_mentioned": string[], "access_issues": string?, "timeline": string?, "notes": string?}',
    messages: [{ role: "user", content: transcript }],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return jobExtractionSchema.parse(extractJson(text));
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
};

export const draftQuoteLineItems = async (
  extraction: JobExtraction,
  contractor: ContractorContext,
): Promise<QuoteDraft> => {
  const message = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1536,
    system:
      "You propose line items for a UK tradesperson's quote, based on the job details and the contractor's " +
      "known rates. You do NOT calculate totals — the app does that in code. For any quantity or price you " +
      "cannot know for certain (e.g. labour days, material quantities), set assumed:true and explain in " +
      "assumption_note. Never invent a day rate — use the contractor's rates provided. " +
      "If similar_past_jobs are provided, use them as reference for realistic quantities and pricing on " +
      "comparable work, but always prioritise this job's own details. " +
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
