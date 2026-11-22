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
//
// Because the claim is spent first, the row also records what then happened
// (`outcome` done|refused, with the words shown to the contractor). Without
// that, a second tap on a refused card was indistinguishable from a second tap
// on a sent one and reported "Done" for something that never happened. A claimed
// row with NO outcome means the request died mid-flight: that is reported as
// "can't tell", never as either result.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { formatGBP } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { loadAssumptionRecord } from "./assumptions";
import { lineItemsOf, loadJobBundle, sanitiseForModel } from "./data";
import { quoteFingerprint, sendReadiness } from "./quote-card";
import { deriveInvoiceAmount } from "@/lib/invoice-amount";
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
  amount: z.number().positive(),
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
  const to = [customer.email, customer.phone]
    .filter((part): part is string => Boolean(part))
    .map((part) => sanitiseForModel(part, 80))
    .join(" and ");
  await supersedeOpenSends(ctx, jobId);
  return createPending(
    ctx,
    "send_quote",
    {
      jobId,
      quoteId: bundle.quote.id,
      fingerprint: quoteFingerprint(lineItems, ctx.contractor.vat_registered, customer),
    },
    `Send the quote to ${sanitiseForModel(customer.name, 60)}?`,
    `${formatGBP(total)}${ctx.contractor.vat_registered ? " including VAT" : ""}, to ${to}.`,
    "Yes, send it",
  );
};

// The same derivation createInvoice uses, so the card states the amount that
// will actually be raised. If it can't be derived, no card is proposed.
const invoiceAmountFor = (
  bundle: NonNullable<Awaited<ReturnType<typeof loadJobBundle>>>,
  invoiceType: "deposit" | "final",
): number => {
  try {
    return deriveInvoiceAmount(
      invoiceType,
      Number(bundle.quote?.total ?? 0),
      bundle.invoices.map((invoice) => ({ amount: invoice.amount, invoice_type: invoice.invoice_type })),
      bundle.contract
        ? [{ deposit_pct: bundle.contract.deposit_pct, status: bundle.contract.status }]
        : [],
      { workCompletedAt: bundle.job.work_completed_at },
    );
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "That invoice can't be raised yet.");
  }
};

// One live send proposal per job: a newer one replaces an older, so two cards
// for the same quote can never both be confirmable.
const supersedeOpenSends = async (ctx: GateContext, jobId: string): Promise<void> => {
  const { data } = await ctx.db
    .from("pa_pending_actions")
    .select("id, args")
    .eq("contractor_id", ctx.contractor.id)
    .eq("action", "send_quote")
    .is("confirmed_at", null);
  const stale = ((data as { id: string; args: { jobId?: string } }[] | null) ?? [])
    .filter((row) => row.args?.jobId === jobId)
    .map((row) => row.id);
  if (stale.length > 0) {
    await ctx.db
      .from("pa_pending_actions")
      .delete()
      .eq("contractor_id", ctx.contractor.id)
      // A tap can claim one of these between the select above and this delete.
      // A spent row is evidence of what was confirmed and must never be removed.
      .is("confirmed_at", null)
      .in("id", stale);
  }
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
  const amount = invoiceAmountFor(bundle, invoiceType);
  const who = sanitiseForModel(bundle.customer?.name ?? "the customer", 60);
  const to = bundle.customer?.contact?.email ?? bundle.customer?.contact?.phone;
  return createPending(
    ctx,
    "create_invoice",
    { jobId, quoteId: bundle.quote.id, invoiceType, amount },
    `Raise the ${invoiceType} invoice for ${who}?`,
    `${formatGBP(amount)}${to ? `, sent to ${sanitiseForModel(to, 80)}` : ""}. It goes to the customer as soon as you confirm.`,
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
  | { ok: false; message: string; code?: "already_done" | "refused" | "in_doubt" };

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
      .select("id, confirmed_at, expires_at, outcome, outcome_message")
      .eq("id", pendingId)
      .eq("contractor_id", ctx.contractor.id)
      .eq("thread_id", ctx.threadId)
      .maybeSingle();
    const row = existing as {
      confirmed_at: string | null;
      outcome: "done" | "refused" | null;
      outcome_message: string | null;
    } | null;
    if (!row) return { ok: false, message: "That confirmation isn't valid." };
    if (row.confirmed_at) {
      // Report what REALLY happened to the first tap. "Already done" is only
      // true if it was.
      if (row.outcome === "done") {
        return { ok: false, message: "That's already been done.", code: "already_done" };
      }
      if (row.outcome === "refused") {
        return {
          ok: false,
          message: row.outcome_message ?? "That didn't go through. Ask me again.",
          code: "refused",
        };
      }
      return { ok: false, message: IN_DOUBT_MESSAGE, code: "in_doubt" };
    }
    return { ok: false, message: "That confirmation has expired. Ask me again and I'll set it up fresh." };
  }

  const action = (claimed as { action: PendingActionKind; args: unknown }).action;
  const args = (claimed as { args: unknown }).args;

  let result: ConfirmResult;
  try {
    result = await execute(ctx, action, args);
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 240) : "";
    result = {
      ok: false,
      message: `That didn't go through${reason ? `: ${reason}` : ""}. Nothing was changed that I know of. Ask me again to retry.`,
    };
  }
  await recordOutcome(ctx, pendingId, result);
  return result;
};

const IN_DOUBT_MESSAGE =
  "I can't tell whether that went through. Check the job page before asking me again.";

// Written once, after the action has run or been refused. Best effort by design:
// if this write fails the contractor still gets the real result on this tap, and
// a later tap sees a claimed row with no outcome and says "can't tell", which is
// honest. It must never throw into the confirm path.
const recordOutcome = async (
  ctx: GateContext,
  pendingId: string,
  result: ConfirmResult,
): Promise<void> => {
  try {
    await ctx.db
      .from("pa_pending_actions")
      .update({
        outcome: result.ok ? "done" : "refused",
        outcome_message: result.message.slice(0, 500),
      })
      .eq("id", pendingId)
      .eq("contractor_id", ctx.contractor.id)
      .eq("thread_id", ctx.threadId)
      .is("outcome", null);
  } catch {
    // See above.
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
  const current = quoteFingerprint(
    lineItemsOf(bundle.quote),
    ctx.contractor.vat_registered,
    readiness.customer,
  );
  if (current !== args.fingerprint) {
    return {
      ok: false,
      message: "Not sent: the quote or who it's going to changed after you were asked. Check the card and ask me to send it again.",
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
  if (invoiceAmountFor(bundle, args.invoiceType) !== args.amount) {
    return { ok: false, message: "Not raised: the amount changed after you were asked. Ask me again." };
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
