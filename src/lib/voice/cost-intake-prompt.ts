/**
 * Voice cost capture prompt.
 *
 * Instructs the model to capture a single cost from spoken input:
 * - Amount (parsed deterministically from transcript)
 * - Counterparty (who/where it was spent)
 * - Category (inferred from context)
 * - Job (matched from spoken reference)
 *
 * One cost per recording — multiple costs are explicitly refused.
 */

import type { RealtimeToolDef } from "@/lib/realtime";

type JobSummary = {
  id: string;
  customer_name: string;
  created_at: string;
};

export const COST_INTAKE_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "draft_cost",
    description:
      "Draft a cost from the captured information. Call this once you have amount, counterparty (or confirmed it's missing), and job.",
    parameters: {
      type: "object",
      properties: {
        amount_words: {
          type: "string",
          description:
            "The EXACT WORDS the contractor used for the amount (e.g. 'two eighty', 'two hundred and eighty pounds'). Do NOT convert to a number — parsing happens separately.",
        },
        // THE BASIS, THE VAT AND WHETHER IT IS PAID — all three were missing, and
        // all three are stored fields the voice path simply never filled.
        //
        // Same division of labour as amount_words: the model reports what was
        // SAID, code does the arithmetic (src/lib/cost-vat-basis.ts). "unknown"
        // is a real answer here and must be given honestly — it is what makes
        // the assistant ask rather than guess, and guessing is how £120 paid on
        // a card was filed as £120 net and unpaid.
        amount_basis: {
          type: "string",
          enum: ["net", "gross", "unknown"],
          description:
            "What the amount the contractor said REFERS to. 'net' if they said before/excluding VAT or plus VAT; 'gross' if they said including VAT, inc VAT, or it is the total they actually paid; 'unknown' if they just named a figure. Never guess — 'unknown' makes Motko ask.",
        },
        vat_amount_words: {
          type: ["string", "null"],
          description:
            "The EXACT WORDS for the VAT amount, if they stated one separately (e.g. 'twenty quid VAT'). Null otherwise. Do NOT convert to a number and do NOT compute it yourself.",
        },
        vat_treatment: {
          type: "string",
          enum: ["standard", "zero", "exempt", "reverse_charge", "unknown"],
          description:
            "'standard' for ordinary VAT-bearing spending; 'zero' or 'exempt' where they say so; 'reverse_charge' for CIS reverse charge; 'unknown' if nothing indicates it. Use 'zero' when they say the person or supplier is not VAT registered.",
        },
        paid: {
          type: ["boolean", "null"],
          description:
            "True if they said it is already paid ('paid on the card', 'paid him in cash', 'settled it'). False if they said it is still outstanding ('on account', 'invoice to come'). Null if they did not say — do not assume either way.",
        },
        counterparty_name: {
          type: ["string", "null"],
          description:
            "Who/where the money was spent (e.g. 'Screwfix', 'Billy the plasterer'). Null if not mentioned.",
        },
        category: {
          type: "string",
          enum: ["materials", "labour", "subcontractor", "plant_hire", "other"],
          description:
            "Inferred from context: materials (merchants/supplies), subcontractor (named person + trade), labour (helpers), plant_hire (equipment rental), other (fallback).",
        },
        // #274: the model reports WHAT WAS SAID, and does not pick the job.
        //
        // This was `job_id` + `job_display`, chosen by the model from a list in
        // the prompt. The client took the id as given and the server validated
        // only that the job BELONGS to the contractor — not that it was the one
        // they meant. Two "Smith" jobs and "the Smith job" resolved to whichever
        // the model liked, ownership passed, and the cost landed on the wrong
        // job's P&L silently.
        //
        // With no id field there is nothing for a guess to travel in, which is
        // what makes this structural rather than instructed. Same shape as the
        // money rule one field over: the model supplies words, code decides.
        // Named to avoid the string `job_reference`: `jobs` has no such column
        // and #453 freezes an assertion that the prompt never mentions one, so
        // a field called job_reference_words would fail a shipped contract for
        // a naming choice with no behaviour behind it.
        job_spoken_words: {
          type: "string",
          description:
            "The contractor's own words identifying the job, verbatim — e.g. 'the Henderson job', " +
            "'for Smith', 'the last job'. Do NOT resolve this to an id or a label yourself.",
        },
        description: {
          type: "string",
          description:
            "A brief description of the cost (e.g. 'Materials from Screwfix', 'Paid plasterer Billy').",
        },
      },
      required: [
        "amount_words",
        // Required so the model must COMMIT to an answer, including "unknown".
        // Optional, it would simply be omitted on the calls that matter most.
        "amount_basis",
        "vat_treatment",
        "category",
        "job_spoken_words",
        "description",
      ],
    },
  },
];

/**
 * Build the system instructions for voice cost capture.
 *
 * The model asks for: amount, what/where (counterparty), and which job.
 * Amount parsing happens deterministically from the transcript, never from
 * model-authored fields.
 */
export function buildCostIntakeInstructions(params?: {
  contractorName: string;
  jobs: JobSummary[];
}): string {
  const jobsContext =
    params && params.jobs.length > 0
      ? `\n\n**Contractor's recent jobs:**\n${params.jobs
          .slice(0, 10)
          .map(
            (j) =>
              `- ${j.customer_name} — created ${j.created_at}`,
          )
          .join("\n")}\n\nWhen the contractor mentions a job, match it against this list. If they say 'the last job' or 'the one I just finished', pick the most recently created.`
      : "\n\n**Note:** This contractor has no jobs yet. If they mention a job, tell them: 'You don't have any jobs yet — create one first, then add costs to it.'";

  return (
    "You are helping a UK contractor capture a cost by voice — a quick drive-back-from-the-merchant " +
    "recording while their hands aren't free. Keep it brief and natural; this is a voice conversation, " +
    "not a form. " +
    jobsContext +
    "\n\n" +
    "**What you're capturing (one cost per recording):**\n" +
    "- **Amount** — how much they spent (you'll report the exact words they used; parsing happens separately)\n" +
    "- **Counterparty** — who/where they spent it (merchant, supplier, subcontractor)\n" +
    "- **Job** — which job this cost is for (customer name)\n" +
    "- **Category** — inferred from context (materials, subcontractor, labour, plant hire, other)\n" +
    "\n\n" +
    "**Opening:**\n" +
    "Start the conversation the moment it connects (the contractor hasn't spoken yet). Say something " +
    "brief and inviting like: 'Alright — tell me about the cost: what you bought, how much, and which " +
    "job it's for.'\n" +
    "\n\n" +
    "**Capturing the amount:**\n" +
    "When the contractor mentions the amount, capture the EXACT WORDS they used in your tool call " +
    "(e.g. 'two eighty', 'two hundred and eighty pounds', 'two pounds eighty'). Do NOT convert it to " +
    "a number yourself — parsing happens deterministically from the transcript. If they say an amount, " +
    "repeat it back in full words to confirm (e.g. 'That's two hundred and eighty pounds — is that right?'). " +
    "If you didn't catch an amount, ask: 'Sorry, I didn't catch the amount — how much was it?'\n" +
    "\n\n" +
    "**Before or after VAT, and is it paid:**\n" +
    "These are two more things a cost record needs, and getting them wrong is expensive in a way the " +
    "contractor cannot see. A gross figure filed as net overstates what the job cost them and loses the " +
    "VAT they can reclaim; a cost they have already paid filed as unpaid leaves them chasing a bill that " +
    "is settled.\n" +
    "- Set amount_basis to 'gross' when they say including VAT, inc VAT, 'all in', or it is plainly the " +
    "total that left their account ('a hundred and twenty on the card'). Set it to 'net' when they say " +
    "before VAT, excluding VAT, or plus VAT.\n" +
    "- If they state the VAT separately ('a hundred plus twenty VAT'), put those exact words in " +
    "vat_amount_words. Never work the VAT out yourself — Motko does that.\n" +
    "- Set vat_treatment to 'zero' when they say the supplier or person is not VAT registered, " +
    "'reverse_charge' for CIS reverse charge, 'standard' for ordinary spending, 'unknown' if nothing " +
    "said either way.\n" +
    "- Set paid true only if they SAID it is paid ('paid it on the card', 'gave him cash'), false if " +
    "they said it is still owing ('on account', 'invoice to follow'), and null if they did not say. " +
    "Do not infer it from the tense.\n" +
    "IF THEY JUST NAME A FIGURE on ordinary VAT-bearing spending and nothing indicates which it is, " +
    "ASK — 'Was that before or after VAT?' — and set amount_basis from their answer. One short question " +
    "is cheaper than a wrong number in their books, and Motko will refuse to save the cost without it. " +
    "Do not ask where it cannot matter: a zero-rated or exempt cost has the same net and gross, and a " +
    "stated VAT amount already settles it.\n" +
    "\n\n" +
    "**Counterparty and category:**\n" +
    "Capture who/where they spent it (e.g. 'Screwfix', 'Billy the plasterer'). Infer the category from " +
    "context:\n" +
    "- **materials** if they name a merchant (Screwfix, Wickes, Travis Perkins, Toolstation, etc.) or " +
    "materials (cable, sockets, plaster, screws, etc.)\n" +
    "- **subcontractor** if they name a person and a trade (e.g. 'paid Billy the plasterer')\n" +
    "- **labour** if they describe paying a helper or laborer\n" +
    "- **plant_hire** if they mention hiring equipment (scaffold, digger, van, compressor, etc.)\n" +
    "- **other** as the fallback\n" +
    "\n\n" +
    "If they don't mention who/where, that's fine — leave counterparty null and note 'No counterparty " +
    "specified' in your summary.\n" +
    "\n\n" +
    "**Which job:**\n" +
    "They must tell you which job this cost is for. Listen for:\n" +
    "- Customer name (e.g. 'the Henderson job', 'for Smith')\n" +
    "- Recency (e.g. 'the last job', 'the one I finished yesterday')\n" +
    "\n\n" +
    "Pass their words through in `job_spoken_words` EXACTLY as spoken. Do not pick a job from the " +
    "list above and do not resolve the reference yourself — matching is done deterministically after " +
    "your tool call, and it will tell you if the reference is ambiguous or matches nothing.\n" +
    "\n\n" +
    "If they don't mention a job at all, ask: 'Which job was that for?'\n" +
    "\n\n" +
    "**One cost at a time:**\n" +
    "If the contractor mentions multiple costs in one recording (e.g. 'I spent two eighty at Screwfix and " +
    "then another sixty at Wickes'), respond: 'Got it — let me capture the Screwfix one first. After this, " +
    "start another recording for the Wickes cost so each one is saved separately.' Only draft the first " +
    "cost mentioned.\n" +
    "\n\n" +
    "**Wrapping up:**\n" +
    "Once you have amount, counterparty (or confirmed it's missing), and job, confirm what you heard and " +
    "let them know the draft is ready: 'Got it — [amount] at [counterparty] for [customer/job]. I'll show " +
    "you the draft to confirm.'\n" +
    "\n\n" +
    "**Tone:**\n" +
    "Trade-friendly, brief, and practical. No corporate pleasantries ('thank you for', 'I appreciate'). " +
    "Sound like a colleague helping them tick it off the list."
  );
}
