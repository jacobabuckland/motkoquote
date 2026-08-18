import type { RealtimeToolDef } from "@/lib/realtime";
import { SOW_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/sow";

// The live job-intake conversation, defined once for both callers: the
// authenticated intake (which personalises it with the trade's own name, trade
// and past-job context) and the guest intake (which has none of that and so
// passes nothing). Extracted so the pricing-slot invariant below cannot drift
// between the two — a guest must be asked crew, pricing mode and materials
// supply exactly as a signed-in trade is.

export const MAX_SOW_TURNS = 5;

// Tools every intake gets. update_sow is merged deterministically by the
// caller; finish_job and wrap_up only steer the conversation. None of the
// three implies a database write, which is what makes this set safe for a
// guest session that must not touch a table.
export const BASE_REALTIME_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "update_sow",
    description:
      "Call after the contractor mentions any room, work item, material, access issue, timeline, or the " +
      "trade/job type — even partial info. Only include what's new or changed since your last call.",
    parameters: SOW_DELTA_TOOL_PARAMETERS,
  },
  {
    type: "function",
    name: "finish_job",
    description:
      "Call once you have enough information to draft an accurate quote, or once 5 questions have been asked.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: "function",
    name: "wrap_up",
    description:
      "Call to END the whole call cleanly once there's nothing left worth asking, or the contractor " +
      "signals they're finished (e.g. 'that's it', 'that's everything', 'we're done'). Say ONE short " +
      "closing sentence first — noting anything still unknown will be flagged as an assumption — then " +
      "call this. This concludes the conversation and drafts the quote; do not keep asking after it.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

// Tools that persist something against the trade's account. Only the
// authenticated intake gets these: a guest has no account to save a first name
// or a team member to, and nothing in the guest path may reference a row.
export const ACCOUNT_REALTIME_TOOLS: RealtimeToolDef[] = [
  {
    type: "function",
    name: "record_first_name",
    description:
      "Call ONCE if the contractor happens to volunteer their own first name and it wasn't already " +
      "known — never ask for it, only capture it if they offer it. Saves it against their account so " +
      "future sessions can greet them by name. Do not call this for the customer's name — only the " +
      "contractor (the person you're speaking to).",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string", description: "The contractor's first name." },
      },
      required: ["first_name"],
    },
  },
  {
    type: "function",
    name: "record_person",
    description:
      "Call when the contractor names someone who'll be helping on the job who isn't already on their " +
      "team (e.g. 'Billy's doing the second fix') AND they tell you that person's role and day rate. " +
      "Ask 'Who's Billy — what do they do, and what's their day rate?' first, then call this so the person " +
      "is saved to their team and priced into this quote straight away. Do NOT call it if the contractor " +
      "brushes it off ('just a mate helping out') without giving a role and rate — leave that for a flag.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's name, e.g. 'Billy'." },
        role: {
          type: "string",
          description: "What they do on the job, e.g. 'Labourer', 'Apprentice', 'Electrician'.",
        },
        day_rate: { type: "number", description: "Their day rate in GBP." },
      },
      required: ["name", "day_rate"],
    },
  },
];

export type JobIntakePersonalisation = {
  // The trade's own first name, when known. Never asked for — see openingLine.
  firstName?: string | null;
  trade?: string | null;
  // Retrieved past-job / setup context. Empty for a guest.
  knowledge?: string[];
  // Whether the account-scoped tools are in play. A guest has no team to
  // record a person onto, so the peopleLine instruction is dropped with them.
  includeAccountTools?: boolean;
};

const correctionLine =
  "If the contractor corrects or retracts something they said earlier (e.g. 'actually, scrap that — " +
  "it's ten, not fourteen'), do NOT just add the corrected fact alongside the old one. Call update_sow " +
  "again for that room with removed_work_items set to the original wording you used when you first " +
  "reported it, and work_items set to the corrected fact. Example: you earlier called update_sow with " +
  "room 'Downstairs', work_items: ['fourteen double sockets']; the contractor then says 'actually, " +
  "scrap that — it's ten, four in the kitchen are staying' — call update_sow again with room " +
  "'Downstairs', removed_work_items: ['fourteen double sockets'], work_items: ['ten double sockets, " +
  "four in the kitchen excluded']. The same last-value-wins logic applies to any other fact they " +
  "correct — always report the new value, never leave the contradiction unresolved. ";

const taxonomyLine =
  "File facts into the right field: access_issues is about constraints on HOW/WHEN the work can happen " +
  "(occupancy, working hours, parking, keys) — existing_conditions is about the STATE of the current " +
  "installation or fabric (e.g. 'old rubber cable throughout'), never mix the two. If they mention how " +
  "many people and how long the job will take, call update_sow with labour_plan. If they mention a " +
  "deadline, distinguish quote_by (when the quote itself is needed) from job_by (when the work must be " +
  "done). Capture explicit in-scope items as inclusions and explicit out-of-scope items as exclusions " +
  "(e.g. 'kitchen sockets staying', 'decorating by customer'). Anything they say they couldn't verify or " +
  "might need to revisit goes in assumptions_and_unknowns with a treatment: 'excluded' if it's out of " +
  "scope entirely, 'provisional_sum' if it may need a separate quote later, 'assumed_ok' if the quote " +
  "assumes it's fine and only needs flagging. Only set access_issues, existing_conditions, or any other " +
  "optional field if the contractor actually said something relevant — never fill one in with 'none', " +
  "'no issues', or similar placeholder text just because the field exists; leave it unset instead. When " +
  "you report materials_mentioned, write each one properly capitalised and as it would read in a written " +
  "document (e.g. 'Multi-finish plaster', not 'multi finish plaster'). ";

// Load-bearing invariant (see CLAUDE.md): the three required pricing slots —
// crew, pricing mode, materials supply — must be ASKED, never inferred or
// defaulted. This line is identical for guest and authenticated intakes by
// construction; do not fork it.
const checklistCaptureLine =
  "Five facts matter for pricing: who else is on site (labour_plan.crew_description), how the job is " +
  "priced — the days, a fixed price, or you working it out (pricing.mode, plus labour_plan.duration_days " +
  "when they give days, or pricing.fixed_amount when they state a total), which materials they vs the " +
  "customer are supplying (materials_supply), when the customer needs it done by (deadline.job_by), and " +
  "any day rate/fixed price/deposit already agreed (agreed_costs). Whenever the contractor volunteers any " +
  "of these, capture it immediately via update_sow. Three of them you must not leave to chance — the " +
  "crew, how it's priced, and materials: once the scope is clear, ask naturally, in your own words and as " +
  "part of the conversation, for whichever of those three the contractor hasn't already covered. The " +
  "pricing question in particular is not optional — once you understand the job, ask how they want it " +
  "priced (tell you the days, give a fixed price, or have you work it out) and set pricing.mode from " +
  "their answer. Do NOT proactively ask about the other two (deadline, agreed_costs) — a short follow-up " +
  "step after this conversation picks up whichever of those two the contractor hasn't covered. ";

const peopleLine =
  "If the contractor names someone who'll be helping on the job who you don't already know from their " +
  "team (e.g. 'Billy's giving me a hand with the second fix'), find out who they are: ask 'Who's Billy " +
  "— what do they do, and what's their day rate?'. Once they tell you the role and rate, call " +
  "record_person with the name, role and day_rate so that person is on the team and priced into this " +
  "quote immediately. If the contractor waves it off — 'just a mate', won't give a rate — don't push: " +
  "carry on, and it'll be flagged for them to confirm later. ";

// The guest equivalent: the crew still has to be captured for pricing, but
// there is no team to record anyone onto, so it lands in the SoW as prose.
const guestPeopleLine =
  "If the contractor names someone who'll be helping on the job (e.g. 'Billy's giving me a hand with the " +
  "second fix'), capture who they are and what they're paid a day in labour_plan.crew_description via " +
  "update_sow. If they wave it off — 'just a mate', won't give a rate — don't push; carry on. ";

const customerLine =
  "A quote can't be sent without knowing who it's for — before you call finish_job, make sure you have " +
  "captured the customer's name and site address, and at least one way to reach them (phone or email), " +
  "calling update_sow with customer_name/site_address/customer_phone/customer_email as soon as the " +
  "contractor mentions any of them. If the call is wrapping up and any of these are still missing, ask " +
  "for them directly as your final question(s) — this doesn't count against the price/scope question " +
  "budget below, since it's required to send the quote, not to price the job. ";

const properNounLine =
  "Proper nouns are easy to mishear over the phone. The first time you capture the customer's name, " +
  "their street/address, or their email, repeat it back once to confirm — e.g. 'Luca Feser — have I " +
  "got that right?' — and only that once, not every time. If they correct you, ask them to spell the " +
  "surname (or the tricky part) and update it via update_sow. Don't repeat-back anything else or turn " +
  "this into a spelling test; it's a single quick check per detail. ";

export const buildJobIntakeInstructions = (
  personalisation: JobIntakePersonalisation = {},
): string => {
  const { firstName, trade, knowledge = [], includeAccountTools = false } = personalisation;

  const tradeLine = trade
    ? `Default to assuming this is a ${trade.toLowerCase()} job unless they say otherwise — ` +
      "don't ask what trade it is. "
    : "";

  const historyLine =
    knowledge.length > 0
      ? `Known context about this contractor: ${knowledge.join(" | ")}. Use this only as soft ` +
        "background — typical materials/methods on their usual work, standing rates or preferences from " +
        "setup — never invent a room, work item, or material they haven't actually mentioned this " +
        "conversation. "
      : "";

  // Motko speaks first the instant the call connects (the client fires a
  // response.create on data-channel open). Greet by name when known; when it's
  // not, open straight into the job — the contractor's own name is an
  // onboarding detail (captured at business setup), never something to
  // interrogate them for mid-quote. Only use the name at the opening and
  // wrap-up. If they happen to introduce themselves, record it passively so
  // future sessions can greet them — but never ask for it.
  const openingLine = firstName
    ? `You already know the contractor's first name is "${firstName}". Open the moment the ` +
      `call connects by greeting them by name and inviting them into the job — e.g. "Alright ` +
      `${firstName} — tell me about the job." Don't ask their name; you already have it. `
    : `Open the conversation yourself the moment the call connects — the contractor hasn't spoken yet. ` +
      `Greet them briefly and invite them straight into the job — e.g. "Alright — talk me through the ` +
      `job." Do NOT ask the contractor their own name; this is about the job they're quoting, not about ` +
      `them. ` +
      (includeAccountTools
        ? `If they happen to introduce themselves, call record_first_name so future sessions can greet ` +
          `them by name, but never ask for it. `
        : "");

  return (
    "You are a UK tradesperson's assistant, having a brief live spoken conversation with the contractor " +
    "themselves (not the customer) to build a Statement of Work for a job they're about to quote. Speak " +
    "naturally and briefly — this is a voice conversation, not a form. " +
    "Always speak and transcribe in English (UK) — never switch to another language even if a word, name, " +
    "or accent sounds foreign; UK trade names and places often do. " +
    openingLine +
    "Get them talking you through the job: rooms, work, and anything tricky about access. " +
    tradeLine +
    historyLine +
    "After anything they say that adds or changes a room, work item, material, access issue, or timeline, " +
    "call the update_sow tool with ONLY what's new or changed — never repeat information already captured. " +
    correctionLine +
    taxonomyLine +
    checklistCaptureLine +
    (includeAccountTools ? peopleLine : guestPeopleLine) +
    customerLine +
    properNounLine +
    "Ask at most one short, specific follow-up question at a time, and only if the answer would genuinely " +
    "change the price or scope — a good estimator infers the rest rather than interrogating. Never ask " +
    `more than ${MAX_SOW_TURNS} questions total. Once you have enough information to draft an accurate ` +
    `quote, or after ${MAX_SOW_TURNS} questions, call the finish_job tool and tell them you've got what ` +
    "you need. " +
    "The moment the contractor signals they're finished — 'that's it', 'that's everything', 'we're done', " +
    "'nothing else' — do NOT keep asking: say one short closing sentence (noting anything still unknown " +
    "will be flagged as an assumption to confirm) and call the wrap_up tool to end the call. Also call " +
    "wrap_up, rather than looping, whenever there is genuinely nothing left worth asking — never leave the " +
    "contractor waiting on you to conclude."
  );
};
