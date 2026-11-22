// THE CONFIRMATION GATE.
//
// Four things in this product cannot be undone by a tap on "undo": a quote going
// to a customer, an invoice being raised, an invoice being marked paid, and a
// draft being deleted. In chat they are reachable ONLY through this file, in two
// separate steps that are made by two different parties:
//
//   1. PROPOSE  — the model (via a propose_* tool) or the contractor's own Send
//                 button writes a row to pa_pending_actions and shows a confirm
//                 card. Nothing happens to the customer, the money or the data.
//   2. CONFIRM  — the contractor taps the confirm card. That is a separate
//                 authenticated request (a server action in app/chat/actions.ts,
//                 called from the browser), NOT a tool the model holds. The model
//                 has no tool that executes a pending action, so there is no
//                 sequence of tool calls — and so no customer-supplied text, no
//                 prompt injection — that can spend one.
//
// A confirmation is honoured only when the pending action is
//   * the same contractor,
//   * the same thread,
//   * unexpired,
//   * unspent — claimed with a single conditional UPDATE, so two taps (or two
//     tabs) cannot both win, and
//   * still true: the thing proposed is re-read and re-checked at execution
//     (a send is refused if the quote's lines or total have changed since the
//     card was shown, or an assumption has since been un-confirmed).
//
// A claim is spent even when the re-check then refuses. That is deliberate: the
// safe failure is "ask me again", never "it half-ran and can be retried".

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { formatGBP } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { loadAssumptionRecord } from "./assumptions";
import { lineItemsOf, loadJobBundle, sanitiseForModel } from "./data";
import { quoteFingerprint, sendReadiness } from "./quote-card";
import type { ConfirmCard, PaActions, PaContractor, PendingActionKind } from "./types";

export const PENDING_TTL_MS = 10 * 60 * 1000;

export type GateContext = {
  db: SupabaseClient;
  contractor: PaContractor;
  threadId: string;
  actions: PaActions;
  now: () => Date;
};

const uuid = z.string().uuid();

const sendArgs = z.object({ jobId: uuid, quoteId: uuid, fingerprint: z.string().min(8) });
const invoiceArgs = z.object({
  jobId: uuid,
  quoteId: uuid,
  invoiceType: z.enum(["deposit", "final"]),
});
const paidArgs = z.object({
  jobId: uuid,
  invoiceId: uuid,
  paymentMethod: z.enum(["cash", "bank_transfer", "other"]),
});
const deleteArgs = z.object({ jobId: uuid });

export class ProposalRefused extends Error {}

const refuse = (message: string): never => {
  throw new ProposalRefused(message);
};

const createPending = async (
  ctx: GateContext,
  action: PendingActionKind,
  args: Record<string, unknown>,
  title: string,
  summary: string,
  confirmLabel: string,
): Promise<ConfirmCard> => {
  const now = ctx.now();
  const expiresAt = new Date(now.getTime() + PENDING_TTL_MS).toISOString();
  const { data, error } = await ctx.db
    .from("pa_pending_actions")
    .insert({
      thread_id: ctx.threadId,
      contractor_id: ctx.contractor.id,
      action,
      args,
      summary,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  const id = (data as { id?: string } | null)?.id;
  if (error || !id) throw new Error("Couldn't set up the confirmation. Nothing has been done.");
  return {
    type: "confirm",
    pendingActionId: id,
    threadId: ctx.threadId,
    action,
    title,
    summary,
    expiresAt,
    confirmLabel,
    state: "pending",
  };
};

// ---------------------------------------------------------------------------
// Step 1: propose
// ---------------------------------------------------------------------------

export const proposeSendQuote = async (ctx: GateContext, jobId: string): Promise<ConfirmCard> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  if (!bundle || !bundle.quote) return refuse("I can't find that quote.");

  const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, jobId);
  const readiness = sendReadiness(bundle, ctx.contractor.vat_registered, record);
  if (readiness.blockers.length > 0 || !readiness.customer) {
    return refuse(readiness.blockers.join(" "));
  }

  const lineItems = lineItemsOf(bundle.quote);
  const { total } = computeQuoteTotals(lineItems, ctx.contractor.vat_registered);
  const customer = readiness.customer;
  const to = customer.email ?? customer.phone ?? "";
  return createPending(
    ctx,
    "send_quote",
    {
      jobId,
      quoteId: bundle.quote.id,
      fingerprint: quoteFingerprint(lineItems, ctx.contractor.vat_registered),
    },
    `Send the quote to ${sanitiseForModel(customer.name, 60)}?`,
    `${formatGBP(total)}${ctx.contractor.vat_registered ? " including VAT" : ""}, to ${sanitiseForModel(to, 80)}.`,
    "Yes, send it",
  );
};

export const proposeCreateInvoice = async (
  ctx: GateContext,
  jobId: string,
  invoiceType: "deposit" | "final",
): Promise<ConfirmCard> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  if (!bundle || !bundle.quote) return refuse("I can't find that job.");
  if (bundle.quote.status !== "accepted") {
    return refuse("The customer hasn't accepted this quote, so there's nothing to invoice yet.");
  }
  const { total } = computeQuoteTotals(lineItemsOf(bundle.quote), ctx.contractor.vat_registered);
  const who = sanitiseForModel(bundle.customer?.name ?? "the customer", 60);
  return createPending(
    ctx,
    "create_invoice",
    { jobId, quoteId: bundle.quote.id, invoiceType },
    `Raise the ${invoiceType} invoice for ${who}?`,
    `Quote total ${formatGBP(total)}. The invoice amount is worked out from the agreed terms, and it's sent to the customer.`,
    "Yes, raise it",
  );
};

export const proposeMarkPaid = async (
  ctx: GateContext,
  jobId: string,
  invoiceId: string,
  paymentMethod: "cash" | "bank_transfer" | "other",
): Promise<ConfirmCard> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  const invoice = bundle?.invoices.find((candidate) => candidate.id === invoiceId);
  if (!bundle || !invoice) return refuse("I can't find that invoice.");
  if (invoice.status === "paid" || invoice.paid_at) return refuse("That invoice is already paid.");
  const who = sanitiseForModel(bundle.customer?.name ?? "the customer", 60);
  return createPending(
    ctx,
    "mark_paid",
    { jobId, invoiceId, paymentMethod },
    `Mark ${who}'s invoice as paid?`,
    `${formatGBP(invoice.amount)} received by ${paymentMethod.replace("_", " ")}. This settles the job.`,
    "Yes, mark paid",
  );
};

export const proposeDeleteDraft = async (ctx: GateContext, jobId: string): Promise<ConfirmCard> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, jobId);
  if (!bundle) return refuse("I can't find that draft.");
  if (bundle.quote && bundle.quote.status !== "draft") {
    return refuse("That quote has already gone out, so it can't be deleted. Archive it instead.");
  }
  const who = sanitiseForModel(bundle.customer?.name ?? "this", 60);
  return createPending(
    ctx,
    "delete_draft",
    { jobId },
    `Delete ${who === "this" ? "this draft" : `${who}'s draft`}?`,
    "It can't be brought back.",
    "Yes, delete it",
  );
};

// ---------------------------------------------------------------------------
// Step 2: confirm (called only from the contractor's own request)
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { ok: true; message: string; link?: string }
  | { ok: false; message: string };

const assertThreadOwned = async (ctx: GateContext): Promise<boolean> => {
  const { data } = await ctx.db
    .from("pa_threads")
    .select("id")
    .eq("id", ctx.threadId)
    .eq("contractor_id", ctx.contractor.id)
    .maybeSingle();
  return Boolean(data);
};

export const confirmPendingAction = async (
  ctx: GateContext,
  pendingId: string,
): Promise<ConfirmResult> => {
  if (!uuid.safeParse(pendingId).success) {
    return { ok: false, message: "That confirmation isn't valid." };
  }
  if (!(await assertThreadOwned(ctx))) {
    return { ok: false, message: "That confirmation isn't valid." };
  }

  const nowIso = ctx.now().toISOString();
  // The claim. One conditional UPDATE: same contractor, same thread, unspent,
  // unexpired. Whoever's UPDATE matches the row owns the action; any other
  // request matches nothing.
  const { data: claimed } = await ctx.db
    .from("pa_pending_actions")
    .update({ confirmed_at: nowIso })
    .eq("id", pendingId)
    .eq("contractor_id", ctx.contractor.id)
    .eq("thread_id", ctx.threadId)
    .is("confirmed_at", null)
    .gt("expires_at", nowIso)
    .select("id, action, args")
    .maybeSingle();

  if (!claimed) {
    const { data: existing } = await ctx.db
      .from("pa_pending_actions")
      .select("id, confirmed_at, expires_at")
      .eq("id", pendingId)
      .eq("contractor_id", ctx.contractor.id)
      .eq("thread_id", ctx.threadId)
      .maybeSingle();
    const row = existing as { confirmed_at: string | null } | null;
    if (!row) return { ok: false, message: "That confirmation isn't valid." };
    if (row.confirmed_at) return { ok: false, message: "That's already been done." };
    return { ok: false, message: "That confirmation has expired. Ask me again and I'll set it up fresh." };
  }

  const action = (claimed as { action: PendingActionKind; args: unknown }).action;
  const args = (claimed as { args: unknown }).args;

  try {
    return await execute(ctx, action, args);
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "";
    return {
      ok: false,
      message: `That didn't go through${reason ? `: ${reason}` : ""}. Nothing was changed that I know of. Ask me again to retry.`,
    };
  }
};

const execute = async (
  ctx: GateContext,
  action: PendingActionKind,
  rawArgs: unknown,
): Promise<ConfirmResult> => {
  switch (action) {
    case "send_quote":
      return executeSendQuote(ctx, sendArgs.parse(rawArgs));
    case "create_invoice":
      return executeCreateInvoice(ctx, invoiceArgs.parse(rawArgs));
    case "mark_paid":
      return executeMarkPaid(ctx, paidArgs.parse(rawArgs));
    case "delete_draft":
      return executeDeleteDraft(ctx, deleteArgs.parse(rawArgs));
    default:
      return { ok: false, message: "I don't know how to do that." };
  }
};

const executeSendQuote = async (
  ctx: GateContext,
  args: z.infer<typeof sendArgs>,
): Promise<ConfirmResult> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, args.jobId);
  if (!bundle?.quote || bundle.quote.id !== args.quoteId) {
    return { ok: false, message: "I can't find that quote any more." };
  }
  const record = await loadAssumptionRecord(ctx.db, ctx.contractor.id, args.jobId);
  const readiness = sendReadiness(bundle, ctx.contractor.vat_registered, record);
  if (readiness.blockers.length > 0 || !readiness.customer) {
    return { ok: false, message: `Not sent. ${readiness.blockers.join(" ")}` };
  }
  const current = quoteFingerprint(lineItemsOf(bundle.quote), ctx.contractor.vat_registered);
  if (current !== args.fingerprint) {
    return {
      ok: false,
      message: "Not sent: the quote changed after you were asked. Check the new figures and ask me to send it again.",
    };
  }

  const result = await ctx.actions.sendQuote({
    jobId: args.jobId,
    quoteId: args.quoteId,
    customer: readiness.customer,
  });
  const name = sanitiseForModel(readiness.customer.name, 60);
  return result.delivered
    ? { ok: true, message: `Sent to ${name}.`, link: `/jobs/${args.jobId}` }
    : {
        ok: true,
        message: `Marked as sent, but it didn't reach ${name} on any channel. Copy the link from the job page and send it yourself.`,
        link: `/jobs/${args.jobId}`,
      };
};

const executeCreateInvoice = async (
  ctx: GateContext,
  args: z.infer<typeof invoiceArgs>,
): Promise<ConfirmResult> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, args.jobId);
  if (!bundle?.quote || bundle.quote.id !== args.quoteId || bundle.quote.status !== "accepted") {
    return { ok: false, message: "Not raised: that quote isn't in a state to invoice." };
  }
  await ctx.actions.createInvoice({ quoteId: args.quoteId, invoiceType: args.invoiceType });
  return { ok: true, message: "Invoice raised and sent.", link: `/jobs/${args.jobId}` };
};

const executeMarkPaid = async (
  ctx: GateContext,
  args: z.infer<typeof paidArgs>,
): Promise<ConfirmResult> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, args.jobId);
  const invoice = bundle?.invoices.find((candidate) => candidate.id === args.invoiceId);
  if (!bundle || !invoice || invoice.status === "paid" || invoice.paid_at) {
    return { ok: false, message: "Not marked: I can't find an unpaid invoice like that." };
  }
  const result = await ctx.actions.markInvoicePaid({
    invoiceId: args.invoiceId,
    paymentMethod: args.paymentMethod,
  });
  if ("error" in result) return { ok: false, message: result.error };
  return { ok: true, message: "Marked as paid.", link: `/jobs/${args.jobId}` };
};

const executeDeleteDraft = async (
  ctx: GateContext,
  args: z.infer<typeof deleteArgs>,
): Promise<ConfirmResult> => {
  const bundle = await loadJobBundle(ctx.db, ctx.contractor.id, args.jobId);
  if (!bundle || (bundle.quote && bundle.quote.status !== "draft")) {
    return { ok: false, message: "Not deleted: that isn't a draft any more." };
  }
  await ctx.actions.deleteDraftJob({ jobId: args.jobId });
  return { ok: true, message: "Draft deleted." };
};
