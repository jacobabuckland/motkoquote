import Anthropic from "@anthropic-ai/sdk";
import {
  droppedDraftLineFlag,
  parseQuoteDraft,
  type JobExtraction,
  type QuoteDraft,
} from "@/lib/schemas/job";
import type { SowState } from "@/lib/schemas/sow";
import { DRAFTING_MODEL, DRAFTING_TEMPERATURE } from "@/lib/models";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import { getChargeableStatedPrices } from "@/lib/voice/stated-prices";

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
    model: DRAFTING_MODEL,
    temperature: DRAFTING_TEMPERATURE,
    max_tokens: 512,
    system:
      "You write a short, professional Overview paragraph (3-5 sentences) for a UK tradesperson's " +
      "Statement of Work, to be read by their customer. Base it STRICTLY on the structured job data " +
      "provided — do not invent rooms, work, materials, or assumptions not present in the data. " +
      "Summarise what work is being done and where, in plain language a homeowner would understand, " +
      "then note (in the same paragraph or a short second one) any assumptions being made and that " +
      "they should be confirmed before work starts. Do not repeat every bullet verbatim — synthesise. " +
      // WHAT COUNTS AS AN ASSUMPTION: one about the WORK.
      //
      // The structured SoW handed to this prompt also carries the app's own
      // capture state, and "note any assumptions being made" read naturally
      // across both. So a quote reached a customer with this inside SCOPE OF
      // WORK:
      //
      //   "Please note that customer contact details have not yet been
      //    captured and should be confirmed before work begins, so that
      //    scheduling and any on-site queries can be handled smoothly."
      //
      // A note to the trade, on the document the customer keeps — and that same
      // document carried the customer's name, phone and email in its header.
      // Reported 13 Sep. The model followed the instruction exactly; the
      // instruction did not distinguish an assumption about the job from a gap
      // in the app's own record.
      "An assumption means something about the WORK that the customer can confirm — access, " +
      "condition of surfaces, what is being supplied, timings. NEVER write about what the app " +
      "does or does not yet hold: missing contact details, an address not captured, a slot the " +
      "call did not reach. The customer cannot act on those and they do not belong on their " +
      "document. If the only gaps are of that kind, simply omit the assumptions sentence. " +
      // NEVER RESTATE A FACT THE DOCUMENT ALREADY RENDERS FROM LIVE DATA.
      //
      // This paragraph is generated once, at intake, and frozen into
      // `sow_json.overview_narrative`. Everything around it on the finished
      // document — the letterhead, the timeline table, the priced lines — is
      // re-rendered from the current record every time it is opened. So any
      // fact the prose repeats is a snapshot sitting beside a live copy of
      // itself, and the two drift apart the moment anything changes.
      //
      // Found 19 Sep on a customer's Statement of Work, twice in one
      // paragraph. The letterhead read ASPIRE PLASTERING LIMITED while the
      // prose said "Buckland Plastering will supply all necessary plaster" —
      // the business had been renamed after the narrative was written. The
      // same paragraph said "a crew of three" under a table reading
      // "2-person team".
      //
      // The model is given the company name (see the contractor argument) and
      // was not inventing one. It was told the truth and wrote it down, and
      // writing it down is the defect: the letterhead already says who this
      // is, so the paragraph gains nothing by repeating it and is guaranteed
      // to be wrong eventually.
      "NEVER write the business's name, the customer's name, a crew size, a number of days, or " +
      "a date. The document prints all of those from live records directly above this paragraph; " +
      "repeating them here freezes a copy that will contradict them later. Refer to the " +
      "contractor as \"we\" and to the customer as \"you\". Describe WHAT is being done and WHERE, " +
      "not who by, how many of them, or when. " +
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
};

export const draftQuoteLineItems = async (
  extraction: JobExtraction,
  contractor: ContractorContext,
  statedPrices: StatedPrice[] = [],
): Promise<QuoteDraft> => {
  // Filter to chargeable stated prices (non-superseded, non-excluded, non-already_paid)
  const chargeablePrices = getChargeableStatedPrices(statedPrices);

  // Build the system prompt, adding stated price instructions if any exist
  let systemPrompt =
    "You propose the STRUCTURE of line items for a UK tradesperson's quote, based on the job details and " +
    "the contractor's known rates. You NEVER set prices or totals — the app computes every amount in code " +
    "from the contractor's own confirmed numbers. Any price you were to invent would be discarded. ";

  if (chargeablePrices.length > 0) {
    systemPrompt +=
      "IMPORTANT: This job has LOCKED PRICES for specific items that the contractor stated during intake. " +
      "For these items, you write DESCRIPTIONS ONLY — do not propose any amounts, the locked prices will be " +
      "applied in code. The locked items are: " +
      chargeablePrices
        .map((p) => {
          const qualifiers = [];
          if (p.qualifiers.each) qualifiers.push("each");
          if (p.qualifiers.fitted) qualifiers.push("fitted");
          const qStr = qualifiers.length > 0 ? ` (${qualifiers.join(", ")})` : "";
          return `"${p.item || "unspecified item"}" at £${(p.amount / 100).toFixed(2)}${qStr}`;
        })
        .join("; ") +
      ". When drafting lines for these items, emit structure and description only — the locked amount will " +
      "be applied deterministically. For 'fitted' items, do NOT split into separate labour and materials lines. ";
  }

  systemPrompt +=
    "CRITICAL CONSTRAINTS on generated content: " +
    "1) NEVER invent brands, finishes, ratings, or product details that are not in the transcript. Only " +
    "include specific product details (brands like 'Hager', finishes like 'brushed steel', ratings like " +
    "'IP65') when they were explicitly stated. When the contractor did not specify these details, describe " +
    "the item generically. " +
    "2) NEVER use phrases like 'as agreed', 'as discussed', 'as per our conversation', or 'as we discussed' " +
    "in customer_note fields UNLESS they come directly from a captured field in the job data (e.g., the " +
    "contractor actually said those words in the transcript). Do not generate these phrases — they imply a " +
    "prior agreement that may not exist. " +
    "Emit " +
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
    "Draft a line for EVERY item in job.scope_items AND job.additional_items — additional_items is the " +
    "catch-all for clearly-requested work (e.g. 'one radiator swap') and must never be dropped. Match " +
    "each to a rate_card where one fits, otherwise a labour/material/provisional line. If an item genuinely " +
    "cannot be priced from the data, still emit a provisional line so it appears — never silently omit it. " +
    "If similar_past_jobs are provided, use them as reference for realistic quantities and days on " +
    "comparable work, but always prioritise this job's own details. " +
    "If known_material_prices are provided they are contractor-confirmed — you still just estimate; the " +
    "app will substitute the confirmed price. " +
    "TWO NOTE CHANNELS. Every line may carry an optional `customer_note` and/or `contractor_flag`. " +
    "`customer_note` is customer-facing prose that renders ON the quote document — use it only for things " +
    "the customer should read (e.g. 'Tiles to be supplied by you'). NEVER write app-directed or " +
    "verification language here (no 'verify', 'confirm before issuing', 'apply markup', 'adjust once'). " +
    "`contractor_flag` is a PRIVATE note to the contractor that NEVER appears on any customer document — " +
    "use it for verification requests, rate uncertainty, or people mentioned in the job who aren't in " +
    "team_members (e.g. 'A mate is helping Tuesday — confirm their day rate'). For a job-wide private note " +
    "not tied to one line, add it to the top-level `contractor_flags` array. When in doubt whether a note " +
    "is customer-safe, put it in contractor_flag, not customer_note. " +
    // WAITING ON A RE-RECORD, deliberately not applied. A plasterer's quote
    // carried "The £48 delivery has a locked price applied in code. The £65
    // delivery has been estimated at 6500p" — the model reading
    // `estimated_unit_cost_pence` off its own draft and "applied in code" out
    // of the LOCKED PRICES paragraph above, and handing both back to the
    // contractor. `keepContractorFlags` now drops such a flag at the parse
    // boundary, so the defect is closed either way; this would stop it being
    // written at all, which is better, because a dropped flag is also a note
    // the contractor never gets.
    //
    // It is not in the prompt because tests/pipeline/harness.test.ts pins a
    // hash of this string and replaying a recorded fixture fails the moment it
    // changes. Re-recording needs ANTHROPIC_API_KEY, which no agent session
    // holds. Add this sentence with the next `RECORD_PIPELINE=1` run:
    //
    //   "A contractor_flag is read by a tradesperson on a phone. Write money
    //    in pounds (£65.00, never 6500p), and NEVER mention how this app works
    //    — no field names, no 'in code', no 'locked price', no 'provenance'.
    //    If the only thing a note has to say is about our handling of a price,
    //    do not write the note."
    "The crew make-up, the job duration/number of days, and who supplies which materials were already " +
    "settled in the job interview — do NOT raise a contractor_flag merely asking to confirm the crew, the " +
    "days, or the materials split. If any of those is genuinely unstated, price it from a sensible default " +
    "silently (a provisional line where truly needed), not a flag. The ONE exception is a specific NAMED " +
    "person helping on the job who isn't in team_members — still flag that so their day rate can be " +
    "confirmed. " +
    "Respond with ONLY a JSON object: {\"line_items\": [ <one of the four line shapes above>, ... ], " +
    "\"contractor_flags\": [ <optional job-wide private notes> ]}.";

  const message = await client().messages.create({
    model: DRAFTING_MODEL,
    temperature: DRAFTING_TEMPERATURE,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          job: extraction,
          contractor: {
            trade: contractor.trade,
            day_rate: contractor.day_rate,
            overtime_rate: contractor.overtime_rate,
            callout_min: contractor.callout_min,
            travel_rate: contractor.travel_rate,
            markup_pct: contractor.markup_pct,
            team_members: contractor.team_members,
            similar_past_jobs: contractor.similar_past_jobs,
            known_material_prices: contractor.known_material_prices,
            rate_cards: contractor.rate_cards,
          },
        }),
      },
    ],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Resilient by line: an unusable line is dropped and reported rather than
  // taking the whole draft down with it. See parseQuoteDraft.
  const { draft, dropped } = parseQuoteDraft(extractJson(text));
  if (dropped.length === 0) return draft;
  return {
    ...draft,
    contractor_flags: [...draft.contractor_flags, ...dropped.map(droppedDraftLineFlag)],
  };
};
