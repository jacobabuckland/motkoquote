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
        job_id: {
          type: "string",
          description:
            "The job ID matched from the contractor's spoken reference (customer name or recency).",
        },
        job_display: {
          type: "string",
          description:
            "Human-readable job label (e.g. 'Henderson — kitchen rewiring', 'MK-1234 — Smith').",
        },
        description: {
          type: "string",
          description:
            "A brief description of the cost (e.g. 'Materials from Screwfix', 'Paid plasterer Billy').",
        },
      },
      required: [
        "amount_words",
        "category",
        "job_id",
        "job_display",
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
    "If they don't mention a job, ask: 'Which job was that for?' If the answer is ambiguous or you can't " +
    "match it confidently, ask for the customer name.\n" +
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
