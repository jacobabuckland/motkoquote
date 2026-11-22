// The tool registry — the whole of what the model can do.
//
// THE RULE THIS FILE EXISTS TO KEEP: no tool in this registry sends a quote,
// raises an invoice, marks anything paid or deletes anything. Those four are
// reachable only through the propose_* tools, which write a pending action and
// return a confirm card; executing one is pending.ts' confirmPendingAction,
// called from the contractor's own authenticated request (the tap on the card).
// There is deliberately NO tool that executes a pending action, so the model
// cannot confirm on its own and nothing a customer typed into a job can make it.
//
// The other guarantees here:
//   * The contractor and thread come from the request, never from tool input.
//     A tool cannot be pointed at another contractor's data by naming it.
//   * Write tools are draft-only (a quote still in 'draft') and wrap the
//     existing server actions rather than reimplementing them.
//   * Money is never computed by the model. Lines the model adds carry the
//     contractor's stated unit price; every total comes from quote-math.
//   * What tools return that originated with customers is sanitised, and the
//     agent loop wraps all of it as untrusted data.

import { z } from "zod";
import { formatGBP } from "@/lib/format";
import { lineItemSchema, type LineItem } from "@/lib/schemas/job";
import { SOW_DELTA_TOOL_PARAMETERS } from "@/lib/schemas/sow";
import { persistJobCustomer } from "@/lib/persist-job-customer";
import {
  ensureAssumptionRecord,
  loadAssumptionRecord,
  setSlotConfirmation,
} from "./assumptions";
import {
  lineItemsOf,
  loadJobBundle,
  loadJobBundles,
  sanitiseForModel,
  type JobBundle,
} from "./data";
import { cleanEmail, isValidEmail } from "./customer-details";
import { loadNeedsAttention, summariseJob } from "./needs-attention";
import {
  proposeCreateInvoice,
  proposeDeleteDraft,
  proposeMarkPaid,
  proposeSendQuote,
  ProposalRefused,
  type GateContext,
} from "./pending";
import { buildQuoteCard } from "./quote-card";
import type {
  AssumptionSlot,
  Card,
  PaTool,
  ToolContext,
  ToolOutput,
  ToolRegistry,
} from "./types";

const uuid = z.string().uuid();

// Strips zod's wrapper keys so the schema is a plain JSON-schema object.
const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void $schema;
  return rest;
};

const gate = (ctx: ToolContext): GateContext => ({
  db: ctx.db,
  contractor: ctx.contractor,
  threadId: ctx.threadId,
  actions: ctx.actions,
  now: ctx.now,
});

const notFound = (): never => {
  throw new Error("I can't find that job.");
};

const requireDraftBundle = async (ctx: ToolContext, jobId: string): Promise<JobBundle> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  if (!bundle || !bundle.quote) return notFound();
  if (bundle.quote.status !== "draft") {
    throw new Error(
      "That quote has already gone out, so I can't edit it from chat. Edit it from the quote page.",
    );
  }
  return bundle;
};

const cardFor = async (ctx: ToolContext, jobId: string): Promise<Card[]> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  if (!bundle) return [];
  const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, jobId);
  const card = buildQuoteCard(bundle, ctx.contractor.vat_registered, record);
  return card ? [card] : [];
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const getNeedsAttention: PaTool = {
  name: "get_needs_attention",
  description:
    "List the jobs where the next move is the contractor's (drafts to send, contracts to raise, invoices to chase). Use when they ask what needs doing.",
  kind: "read",
  inputSchema: jsonSchema(z.object({})),
  run: async (_raw, ctx) => ({
    data: {
      items: await loadNeedsAttention(ctx.db, ctx.contractor, ctx.now().getTime()),
    },
  }),
};

const listJobsInput = z.object({
  filter: z.enum(["all", "draft", "sent", "accepted"]).default("all"),
});

const listJobs: PaTool = {
  name: "list_jobs",
  description: "List the contractor's recent jobs with whose move it is. Optionally filter by quote status.",
  kind: "read",
  inputSchema: jsonSchema(listJobsInput),
  run: async (raw, ctx) => {
    const { filter } = listJobsInput.parse(raw ?? {});
    const bundles = await loadJobBundles(ctx.db, ctx.contractor.id);
    const jobs = bundles
      .filter((bundle) => filter === "all" || bundle.quote?.status === filter)
      .map((bundle) =>
        summariseJob(bundle, ctx.contractor.vat_registered, ctx.now().getTime()),
      )
      .slice(0, 20);
    return { data: { jobs } };
  },
};

const jobIdInput = z.object({ jobId: uuid });

const getJob: PaTool = {
  name: "get_job",
  description:
    "Get one job: its status, lines, assumptions, anything blocking a send, and its invoices. Also shows the quote card.",
  kind: "read",
  inputSchema: jsonSchema(jobIdInput),
  run: async (raw, ctx) => {
    const { jobId } = jobIdInput.parse(raw);
    const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
    if (!bundle) return notFound();
    const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, jobId);
    const card = buildQuoteCard(bundle, ctx.contractor.vat_registered, record);
    const summary = summariseJob(bundle, ctx.contractor.vat_registered, ctx.now().getTime());
    return {
      data: {
        ...summary,
        total: card ? formatGBP(card.total) : null,
        lines: card?.lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          amount: formatGBP(line.amount),
        })),
        assumptions: card?.assumptions,
        canSend: card?.canSend ?? false,
        blockers: card?.blockers ?? [],
        hasEmail: Boolean(bundle.customer?.contact?.email),
        hasMobile: Boolean(bundle.customer?.contact?.phone),
        invoices: bundle.invoices.map((invoice) => ({
          invoiceId: invoice.id,
          type: invoice.invoice_type,
          amount: formatGBP(invoice.amount),
          status: invoice.status,
        })),
      },
      cards: card ? [card] : [],
    };
  },
};

const getMoneyPosition: PaTool = {
  name: "get_money_position",
  description: "How much the contractor is owed, what's safe to spend, and who owes them. Read-only.",
  kind: "read",
  inputSchema: jsonSchema(z.object({})),
  run: async (_raw, ctx) => {
    const position = await ctx.actions.getMoneyPosition();
    const pounds = (pence: number) => formatGBP(pence / 100);
    return {
      data: {
        safeToSpend: pounds(position.safeToSpend.total),
        collected: pounds(position.safeToSpend.collected),
        whatsLeft: pounds(position.whatsLeft),
        afterWhatsOwed: pounds(position.projection.total),
        owedNet: pounds(position.projection.owedNet),
        owedBy: position.owedToYou.slice(0, 8).map((owed) => ({
          customer: sanitiseForModel(owed.customerName, 60),
          owed: pounds(owed.totalOwed),
        })),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// create_quote_draft: text description -> SoW delta -> the existing draft path
// ---------------------------------------------------------------------------

const createDraftInput = z.object({
  description: z.string().trim().min(3).max(2000),
  customer_name: z.string().trim().max(120).optional(),
  customer_email: z.string().trim().max(200).optional(),
  customer_phone: z.string().trim().max(40).optional(),
  site_address: z.string().trim().max(300).optional(),
});

const EXTRACT_SYSTEM = [
  "You turn a UK tradesperson's description of a job into a structured scope of work by calling update_sow.",
  "Record ONLY what the contractor actually said. Never infer or invent: leave a field out when it was not stated.",
  "In particular do NOT set pricing, labour_plan, materials_supply or agreed_costs unless the contractor explicitly stated them (e.g. 'for 850' is a fixed price, 'me and Dave' is a crew of two, 'I'll supply the materials' is materials responsibility).",
  "Never put a price you worked out or guessed anywhere. Do not set `complete` or `next_question`.",
].join(" ");

const createQuoteDraft: PaTool = {
  name: "create_quote_draft",
  description:
    "Start a new draft quote from what the contractor said about the job. Pass their words, plus customer details only if they gave them. The draft is priced from their own rates; it is not sent.",
  kind: "draft_write",
  inputSchema: jsonSchema(createDraftInput),
  run: async (raw, ctx): Promise<ToolOutput> => {
    const input = createDraftInput.parse(raw);

    // 1. Text -> scope-of-work delta, through the injectable LlmClient.
    const extraction = await ctx.llm.complete({
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: input.description }],
      tools: [
        {
          name: "update_sow",
          description: "Record the scope of work the contractor described.",
          input_schema: SOW_DELTA_TOOL_PARAMETERS as unknown as Record<string, unknown>,
        },
      ],
      forceTool: "update_sow",
      maxTokens: 1500,
    });
    const use = extraction.content.find((block) => block.type === "tool_use");
    if (!use || use.type !== "tool_use" || typeof use.input !== "object" || use.input === null) {
      throw new Error("I couldn't pick the job out of that. Say what the work is and I'll try again.");
    }
    const delta: Record<string, unknown> = { ...(use.input as Record<string, unknown>) };
    delete delta.complete;
    delete delta.next_question;
    if (input.customer_name) delta.customer_name = input.customer_name;
    // Cleaned where it enters: a dictated address picks up spaces and the
    // full stop that ends the sentence, and the real send rejects those.
    const customerEmail = cleanEmail(input.customer_email);
    if (customerEmail) delta.customer_email = customerEmail;
    if (input.customer_phone) delta.customer_phone = input.customer_phone;
    if (input.site_address) delta.site_address = input.site_address;

    // 2. The existing manual-job path: an empty draft owned by this contractor.
    const { jobId } = await ctx.actions.createManualJob();

    try {
      // 3. FIRST, before anything that can throw: the assumptions row, with all
      //    three slots unconfirmed. A chat-made job with a value in a slot but no
      //    row would read as voice-confirmed, so the row must exist from the
      //    moment the job does.
      await ensureAssumptionRecord(ctx.db, ctx.contractor.id, jobId, null, ctx.now(), false);

      // 4. Store what was said (the drafter reads the transcript for the
      //    contractor's own words) and merge the delta into the SoW.
      const said = ctx.now().toISOString();
      const { error: transcriptError } = await ctx.db
        .from("jobs")
        .update({
          transcript: input.description,
          conversation_json: [{ speaker: "contractor", text: input.description, at: said }],
        })
        .eq("id", jobId)
        .eq("contractor_id", ctx.contractor.id);
      if (transcriptError) throw new Error("I couldn't save what you said about the job.");
      await ctx.actions.saveSowDelta({ jobId, delta });

      // 5. Customer details, if given, through the same writer the send path uses.
      if (input.customer_name) {
        await persistJobCustomer(ctx.db, {
          jobId,
          contractorId: ctx.contractor.id,
          customerId: null,
          customer: {
            name: input.customer_name,
            email: cleanEmail(input.customer_email),
            phone: input.customer_phone,
            address: input.site_address,
          },
        });
      }

      // 6. Draft and price it from the contractor's own rates (draft -> compile).
      await ctx.actions.redraftJob({ jobId });
    } catch (error) {
      // Don't leave a half-made job behind. Best effort: deleteDraftJob has its
      // own guard and only ever deletes a draft with nothing against it.
      try {
        await ctx.actions.deleteDraftJob({ jobId });
      } catch {
        // The job stays, but its assumptions row exists, so it is still unconfirmed.
      }
      throw error;
    }

    const cards = await cardFor(ctx, jobId);
    const card = cards[0];
    return {
      data: {
        jobId,
        total: card && card.type === "quote" ? formatGBP(card.total) : null,
        assumptions: card && card.type === "quote" ? card.assumptions : [],
        blockers: card && card.type === "quote" ? card.blockers : [],
        note: "Draft created, not sent. The contractor must confirm pricing, crew and materials on the card before it can be sent.",
      },
      cards,
    };
  },
};

// ---------------------------------------------------------------------------
// update_quote
// ---------------------------------------------------------------------------

const changeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_fixed_price"), amount: z.number().positive() }),
  z.object({ op: z.literal("set_pricing_mode"), mode: z.enum(["days", "calculated"]) }),
  z.object({
    op: z.literal("add_line"),
    description: z.string().trim().min(1).max(200),
    category: z.enum(["labour", "materials", "travel", "callout", "other"]),
    quantity: z.number().positive(),
    unit: z.string().trim().min(1).max(30),
    // The contractor's stated price per unit. Never a guess.
    unit_price: z.number().nonnegative(),
  }),
  z.object({
    op: z.literal("set_line"),
    line: z.number().int().min(1),
    description: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().positive().optional(),
    unit_price: z.number().nonnegative().optional(),
  }),
  z.object({ op: z.literal("remove_line"), line: z.number().int().min(1) }),
  z.object({
    op: z.literal("set_customer"),
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    address: z.string().trim().max(300).optional(),
  }),
]);

const updateQuoteInput = z.object({
  jobId: uuid,
  changes: z.array(changeSchema).min(1).max(10),
});

type Change = z.infer<typeof changeSchema>;

const resetSlot = async (
  ctx: ToolContext,
  bundle: JobBundle,
  slot: AssumptionSlot,
): Promise<void> => {
  // Adopt a voice job into the table first so un-confirming one slot does not
  // un-confirm the others the contractor answered aloud.
  const existing = await loadAssumptionRecord(ctx.db, ctx.contractor.id, bundle.job.id);
  if (!existing) {
    await ensureAssumptionRecord(ctx.db, ctx.contractor.id, bundle.job.id, bundle.sow, ctx.now(), true);
  }
  await setSlotConfirmation(ctx.db, ctx.contractor.id, bundle.job.id, slot, null, ctx.now());
};

const applyLineChanges = (lines: LineItem[], changes: Change[], fixedMode: boolean): LineItem[] => {
  const next = [...lines];
  for (const change of changes) {
    if (change.op === "add_line") {
      if (fixedMode) throw new Error("This quote is on a fixed price. Change the amount, or switch to itemised first.");
      next.push(
        lineItemSchema.parse({
          description: change.description,
          category: change.category,
          quantity: change.quantity,
          unit: change.unit,
          unit_price: change.unit_price,
          edited: true,
          provenance: { source: "contractor" },
        }),
      );
    } else if (change.op === "set_line") {
      if (fixedMode) throw new Error("This quote is on a fixed price. Change the amount, or switch to itemised first.");
      const target = next[change.line - 1];
      if (!target) throw new Error(`There's no line ${change.line} on this quote.`);
      if (change.unit_price !== undefined && target.people && target.people.length > 0) {
        throw new Error(
          `Line ${change.line} is priced from the crew's day rates. Change the rate in Business details, or switch to a fixed price.`,
        );
      }
      next[change.line - 1] = {
        ...target,
        ...(change.description !== undefined ? { description: change.description } : {}),
        ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
        ...(change.unit_price !== undefined
          ? { unit_price: change.unit_price, unpriced: undefined }
          : {}),
        edited: true,
        provenance: { source: "contractor" },
      };
    } else if (change.op === "remove_line") {
      if (fixedMode) throw new Error("This quote is on a fixed price. Change the amount, or switch to itemised first.");
      if (!next[change.line - 1]) throw new Error(`There's no line ${change.line} on this quote.`);
      next.splice(change.line - 1, 1);
    }
  }
  return next;
};

const updateQuote: PaTool = {
  name: "update_quote",
  description:
    "Change a DRAFT quote. Ops: set_fixed_price (the contractor's stated total before VAT), set_pricing_mode, add_line (needs the contractor's stated unit price: never guess one), set_line, remove_line (lines are numbered from 1 as on the card), set_customer. You never calculate totals.",
  kind: "draft_write",
  inputSchema: jsonSchema(updateQuoteInput),
  run: async (raw, ctx): Promise<ToolOutput> => {
    const { jobId, changes } = updateQuoteInput.parse(raw);
    const bundle = await requireDraftBundle(ctx, jobId);
    const quote = bundle.quote!;
    const fixedMode = bundle.sow?.pricing?.mode === "fixed";

    const lineOps = changes.filter((c) => ["add_line", "set_line", "remove_line"].includes(c.op));
    const modeOps = changes.filter((c) => c.op === "set_fixed_price" || c.op === "set_pricing_mode");
    const customerOps = changes.filter((c) => c.op === "set_customer");
    if (modeOps.length > 1) throw new Error("Give me one pricing change at a time.");

    // Validate every line op before writing anything.
    const lines = lineItemsOf(quote);
    const nextLines = lineOps.length > 0 ? applyLineChanges(lines, lineOps, fixedMode) : null;

    if (nextLines) {
      await ctx.actions.updateQuoteLineItems({ jobId, quoteId: quote.id, lineItems: nextLines });
    }

    const mode = modeOps[0];
    if (mode) {
      await resetSlot(ctx, bundle, "pricing_mode");
      await ctx.actions.setQuotePricingMode(
        mode.op === "set_fixed_price"
          ? { jobId, quoteId: quote.id, mode: "fixed", fixedAmount: mode.amount }
          : { jobId, quoteId: quote.id, mode: (mode as { mode: "days" | "calculated" }).mode },
      );
    }

    for (const change of customerOps) {
      if (change.op !== "set_customer") continue;
      const name = change.name ?? bundle.customer?.name;
      if (!name) throw new Error("I need the customer's name first.");
      const contact = bundle.customer?.contact ?? {};
      // An address the contractor has just given must be one that will send.
      // Say so now, in words, rather than store it and fail later.
      const newEmail = change.email === undefined ? undefined : cleanEmail(change.email);
      if (change.email !== undefined && !isValidEmail(newEmail)) {
        throw new Error("That email address doesn't look right. Say it again and I'll fix it.");
      }
      await persistJobCustomer(ctx.db, {
        jobId,
        contractorId: ctx.contractor.id,
        customerId: bundle.job.customer_id,
        customer: {
          name,
          email: newEmail ?? contact.email,
          phone: change.phone ?? contact.phone,
          address: change.address ?? contact.address,
          smsOptOut: contact.sms_opt_out,
        },
      });
    }

    const cards = await cardFor(ctx, jobId);
    const card = cards[0];
    return {
      data: {
        applied: changes.map((c) => c.op),
        total: card && card.type === "quote" ? formatGBP(card.total) : null,
        blockers: card && card.type === "quote" ? card.blockers : [],
      },
      cards,
    };
  },
};

// ---------------------------------------------------------------------------
// set_assumption: record what the contractor said; the TAP confirms it
// ---------------------------------------------------------------------------

const assumptionInput = z.discriminatedUnion("slot", [
  z.object({
    slot: z.literal("pricing_mode"),
    jobId: uuid,
    mode: z.enum(["days", "fixed", "calculated"]),
    // Required for fixed: the contractor's own figure, before VAT.
    fixed_amount: z.number().positive().optional(),
  }),
  z.object({
    slot: z.literal("crew"),
    jobId: uuid,
    people_count: z.number().int().min(1).max(20),
    crew_description: z.string().trim().max(200).optional(),
  }),
  z.object({
    slot: z.literal("materials_supply"),
    jobId: uuid,
    responsibility: z.enum(["contractor", "customer", "split"]),
  }),
]);

// What the model is shown for set_assumption. The API wants a plain object at
// the top level, which a discriminated union does not serialise to, so the
// advertised shape is flat and `assumptionInput` above does the real checking.
const assumptionAdvertised = z.object({
  slot: z.enum(["pricing_mode", "crew", "materials_supply"]),
  jobId: uuid,
  mode: z.enum(["days", "fixed", "calculated"]).optional().describe("pricing_mode only"),
  fixed_amount: z
    .number()
    .positive()
    .optional()
    .describe("pricing_mode fixed only: the contractor's own figure before VAT"),
  people_count: z.number().int().min(1).max(20).optional().describe("crew only"),
  crew_description: z.string().max(200).optional().describe("crew only"),
  responsibility: z
    .enum(["contractor", "customer", "split"])
    .optional()
    .describe("materials_supply only: who supplies the materials"),
});

const handEdited = (lines: LineItem[]): boolean =>
  lines.some((line) => line.edited === true || line.provenance?.source === "contractor");

const setAssumption: PaTool = {
  name: "set_assumption",
  description:
    "Record what the contractor told you about the pricing mode, the crew size, or who supplies the materials on a draft. This updates the draft and un-confirms that slot: the contractor then taps it on the card to confirm. You cannot confirm it yourself.",
  kind: "draft_write",
  inputSchema: jsonSchema(assumptionAdvertised),
  run: async (raw, ctx): Promise<ToolOutput> => {
    const input = assumptionInput.parse(raw);
    const bundle = await requireDraftBundle(ctx, input.jobId);
    const quote = bundle.quote!;
    let repriced = true;

    await resetSlot(ctx, bundle, input.slot);

    if (input.slot === "pricing_mode") {
      if (input.mode === "fixed" && input.fixed_amount === undefined) {
        throw new Error("What's the fixed price, before VAT? I won't pick a figure for you.");
      }
      await ctx.actions.setQuotePricingMode(
        input.mode === "fixed"
          ? { jobId: input.jobId, quoteId: quote.id, mode: "fixed", fixedAmount: input.fixed_amount }
          : { jobId: input.jobId, quoteId: quote.id, mode: input.mode },
      );
    } else {
      const delta =
        input.slot === "crew"
          ? {
              labour_plan: {
                people_count: input.people_count,
                crew_description: input.crew_description,
              },
            }
          : { materials_supply: { responsibility: input.responsibility } };
      await ctx.actions.saveSowDelta({ jobId: input.jobId, delta });
      // Re-pricing rebuilds the lines, which would overwrite hand edits. If the
      // contractor has edited any, record the answer and leave the lines alone.
      if (handEdited(lineItemsOf(quote))) {
        repriced = false;
      } else {
        await ctx.actions.redraftJob({ jobId: input.jobId });
      }
    }

    const cards = await cardFor(ctx, input.jobId);
    const card = cards[0];
    return {
      data: {
        slot: input.slot,
        recorded: true,
        confirmed: false,
        repriced,
        total: card && card.type === "quote" ? formatGBP(card.total) : null,
        note: repriced
          ? "Recorded. The contractor still has to tap it on the card to confirm."
          : "Recorded, but the lines were edited by hand so they were not re-priced. Tell the contractor to check the lines. They still have to tap it on the card to confirm.",
      },
      cards,
    };
  },
};

// ---------------------------------------------------------------------------
// propose_*: the only way to ask for a send / invoice / paid / delete
// ---------------------------------------------------------------------------

const proposed = async (run: () => Promise<Card>): Promise<ToolOutput> => {
  try {
    const card = await run();
    return {
      data: {
        proposed: true,
        executed: false,
        note: "A confirm card is on the contractor's screen. Nothing has happened yet. Tell them to check it and tap to confirm.",
      },
      cards: [card],
    };
  } catch (error) {
    if (error instanceof ProposalRefused) {
      return { data: { proposed: false, executed: false, reason: error.message } };
    }
    throw error;
  }
};

const proposeSendQuoteTool: PaTool = {
  name: "propose_send_quote",
  description:
    "Ask to send a draft quote to the customer. This only shows a confirm card; the contractor taps to send. Refused while any assumption is unconfirmed or the quote isn't ready.",
  kind: "gate",
  inputSchema: jsonSchema(jobIdInput),
  run: (raw, ctx) => {
    const { jobId } = jobIdInput.parse(raw);
    return proposed(() => proposeSendQuote(gate(ctx), jobId));
  },
};

const invoiceInput = z.object({ jobId: uuid, invoiceType: z.enum(["deposit", "final"]) });
const proposeCreateInvoiceTool: PaTool = {
  name: "propose_create_invoice",
  description:
    "Ask to raise a deposit or final invoice on an accepted quote. Only shows a confirm card; the contractor taps to raise and send it.",
  kind: "gate",
  inputSchema: jsonSchema(invoiceInput),
  run: (raw, ctx) => {
    const { jobId, invoiceType } = invoiceInput.parse(raw);
    return proposed(() => proposeCreateInvoice(gate(ctx), jobId, invoiceType));
  },
};

const paidInput = z.object({
  jobId: uuid,
  invoiceId: uuid,
  paymentMethod: z.enum(["cash", "bank_transfer", "other"]),
});
const proposeMarkPaidTool: PaTool = {
  name: "propose_mark_paid",
  description:
    "Ask to mark an invoice as paid (cash, bank transfer or other). Only shows a confirm card; the contractor taps to confirm. Get invoice ids from get_job.",
  kind: "gate",
  inputSchema: jsonSchema(paidInput),
  run: (raw, ctx) => {
    const { jobId, invoiceId, paymentMethod } = paidInput.parse(raw);
    return proposed(() => proposeMarkPaid(gate(ctx), jobId, invoiceId, paymentMethod));
  },
};

const proposeDeleteDraftTool: PaTool = {
  name: "propose_delete_draft",
  description:
    "Ask to delete a draft job that was never sent. Only shows a confirm card; the contractor taps to delete.",
  kind: "gate",
  inputSchema: jsonSchema(jobIdInput),
  run: (raw, ctx) => {
    const { jobId } = jobIdInput.parse(raw);
    return proposed(() => proposeDeleteDraft(gate(ctx), jobId));
  },
};

// ---------------------------------------------------------------------------

export const PA_TOOLS: PaTool[] = [
  getNeedsAttention,
  listJobs,
  getJob,
  getMoneyPosition,
  createQuoteDraft,
  updateQuote,
  setAssumption,
  proposeSendQuoteTool,
  proposeCreateInvoiceTool,
  proposeMarkPaidTool,
  proposeDeleteDraftTool,
];

export const buildToolRegistry = (): ToolRegistry => ({
  tools: PA_TOOLS,
  defs: PA_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  })),
});
