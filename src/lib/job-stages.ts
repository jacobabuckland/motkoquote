// Pure derivation of a job's position in the quote → paid pipeline. All state
// is read from existing quote/contract/invoice rows — no new state storage.
// The job detail page (/jobs/[id]) renders the returned stages, "whose move"
// situation and activity timeline from this single source of truth.

import type { StatusLabel } from "@/components/ui/status-chip";
import { isDateOverdue } from "@/lib/overdue";

export type StageKey = "quote_sent" | "accepted" | "contract_signed" | "work_complete" | "invoiced" | "paid";
export type StageState = "complete" | "current" | "future" | "declined" | "forced";
export type Stage = { key: StageKey; label: string; state: StageState; date: string | null };

// Exactly what needs to happen next, and whose job it is. The page maps each
// situation to human copy + at most one primary action.
export type Situation =
  | "draft_quote"
  | "quote_sent"
  | "quote_declined"
  | "quote_archived"
  | "accepted_need_contract"
  | "contract_sent"
  | "contract_declined"
  | "signed_need_invoice"
  | "work_complete"
  | "invoice_unpaid"
  | "invoice_overdue"
  | "paid";

export type NextMove = "contractor" | "customer" | "none";

export type QuoteState = {
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
} | null;

export type ContractState = {
  id: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  deposit_pct: number | null;
} | null;

export type InvoiceState = {
  id: string;
  status: string;
  invoice_type: string;
  due_date: string | null;
  created_at: string;
  paid_at: string | null;
  chase_events?: { channel: string; sent_at: string }[];
};

export type JobState = {
  situation: Situation;
  move: NextMove;
  overallStatus: StatusLabel;
  stages: Stage[];
  // Stages the monotonic pass had to back-fill because a later stage was
  // complete while they weren't — a data inconsistency worth logging. Empty
  // in the normal case.
  inconsistentStages: StageKey[];
  activeInvoice: InvoiceState | null;
  contract: ContractState;
  // A stable dedupe key for telemetry, uniquely identifying this set of forced
  // stages. Null when no stages were forced. Used to log each unique
  // inconsistency exactly once rather than on every page view.
  inconsistencyKey: string | null;
};

export type TimelineEvent = { label: string; at: string };

// The single source of truth for stepper wording. The stepper renders these
// via deriveStages — it never hardcodes its own labels — so this table and the
// StatusLabel taxonomy in status-chip.ts are the only two places pipeline
// vocabulary is defined. Keep the shared terms aligned (Accepted, Signed,
// Paid) so a stage and its status chip never disagree.
const STAGE_LABELS: Record<StageKey, string> = {
  quote_sent: "Quote sent",
  accepted: "Accepted",
  contract_signed: "Contract signed",
  work_complete: "Work complete",
  invoiced: "Invoiced",
  paid: "Paid",
};

// Statuses that are not themselves downstream of sending the quote.
const DRAFT_OR_WITHDRAWN = new Set(["draft", "archived"]);

const STAGE_ORDER: StageKey[] = ["quote_sent", "accepted", "contract_signed", "work_complete", "invoiced", "paid"];

// The stage whose action is pending for a given situation. null = the pipeline
// has stopped (terminal: paid, or declined).
const CURRENT_STAGE: Record<Situation, StageKey | null> = {
  draft_quote: "quote_sent",
  quote_sent: "accepted",
  quote_declined: null,
  quote_archived: null,
  accepted_need_contract: "contract_signed",
  contract_sent: "contract_signed",
  contract_declined: null,
  signed_need_invoice: "invoiced",
  work_complete: "invoiced",
  invoice_unpaid: "paid",
  invoice_overdue: "paid",
  paid: null,
};

const SITUATION_STATUS: Record<Situation, StatusLabel> = {
  draft_quote: "Draft",
  quote_sent: "Sent",
  quote_declined: "Declined",
  quote_archived: "Archived",
  accepted_need_contract: "Accepted",
  contract_sent: "Awaiting signature",
  contract_declined: "Declined",
  signed_need_invoice: "Signed",
  work_complete: "Work complete",
  invoice_unpaid: "Awaiting payment",
  invoice_overdue: "Overdue",
  paid: "Paid",
};

export const isInvoiceOverdue = (invoice: InvoiceState, now = Date.now()): boolean =>
  invoice.status !== "paid" && isDateOverdue(invoice.due_date, now);

const firstUnpaid = (invoices: InvoiceState[]): InvoiceState | null =>
  invoices.find((invoice) => invoice.status !== "paid") ?? null;

export type PaymentStageState = {
  stage_number: number;
  settled_at: string | null;
};

/**
 * Returns true when all payment stages for a job are settled, or when there are
 * no stages at all (ordinary single-payment job). A multi-stage job is not
 * "paid" until every stage settles.
 */
export function deriveJobClosed(stages: PaymentStageState[]): boolean {
  // Empty stages array = no staging, ordinary single-payment job
  if (stages.length === 0) return true;

  // All stages must be settled
  return stages.every((stage) => stage.settled_at !== null);
}

export const deriveSituation = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  now = Date.now(),
  workCompletedAt: string | null = null,
  stages: PaymentStageState[] = [],
): { situation: Situation; move: NextMove } => {
  if (!quote || quote.status === "draft") return { situation: "draft_quote", move: "contractor" };
  if (quote.status === "sent") return { situation: "quote_sent", move: "customer" };
  if (quote.status === "declined") return { situation: "quote_declined", move: "none" };
  // ARCHIVED IS NOT ACCEPTED. It matched none of the branches above and fell
  // through to "accepted from here on", so job 30FAEF2A — an archived quote with
  // sent_at, accepted_at and declined_at ALL null — showed the contractor
  // "✓ Accepted — Send a contract to sign" while the tracker beside it read
  // "Accepted & signed — Your move" and the quote panel read "Declined". Four
  // surfaces, four answers, because each fell into a different default.
  // Terminal and nobody's move: the contractor withdrew it.
  if (quote.status === "archived") return { situation: "quote_archived", move: "none" };

  // Quote is accepted from here on.
  if (contract?.status === "declined") return { situation: "contract_declined", move: "none" };

  const unpaid = firstUnpaid(invoices);

  // A SETTLED DEPOSIT IS NOT A SETTLED JOB.
  //
  // `jobClosed` was `!unpaid` — "no invoice is awaiting payment" — which is
  // true the instant a deposit settles, because the balance has not been
  // invoiced yet and so cannot be outstanding. Reported 13 Sep against a live
  // job: a £72 deposit on a £7,200 contract showed the Paid badge, every
  // milestone ticked, "Job complete — you've been paid", and "Everything's
  // settled. Nothing else to do." The £7,128 the customer contractually owes
  // appeared on no screen in the app — only on the PDF the customer holds.
  //
  // Tested on the invoice TYPE rather than by comparing amounts against the
  // quote total. A deposit is partial by definition, so this needs no figures
  // and cannot be thrown by the two columns disagreeing about units. It is
  // also the narrower claim: a `final` invoice raised for less than the quote
  // is a different question — a discount, a variation — and the contractor's
  // to answer, not this function's.
  const settledDeposit = invoices.some(
    (invoice) =>
      invoice.invoice_type === "deposit" && (invoice.status === "paid" || invoice.paid_at !== null),
  );
  const hasClosingInvoice = invoices.some((invoice) => invoice.invoice_type !== "deposit");
  // A 100% DEPOSIT IS THE WHOLE JOB, and the one case the type test above
  // cannot see. `deposit_pct` is already on the contract, so this stays a
  // comparison of the contractor's own stated split rather than of amounts.
  //
  // Without it a job invoiced and paid in full through a single deposit could
  // never close: Ines Kovac's £600 job, paid, work marked complete, still
  // reading "Mark the work complete, then invoice", with both invoice routes
  // correctly refusing because there was nothing left to invoice. The refusals
  // were right; there was no end state for them to point at.
  const depositIsWholeJob = (contract?.deposit_pct ?? 0) >= 100;
  const depositOnly = settledDeposit && !hasClosingInvoice && !depositIsWholeJob;

  // For staged jobs, check if all stages are settled rather than just invoice status
  const jobClosed = stages.length > 0 ? deriveJobClosed(stages) : !unpaid && !depositOnly;

  // The deposit is settled and nothing else has been raised. The next move is
  // the contractor's, and it is the same move as a signed job with no invoice
  // at all: raise the one that is due. Deliberately reusing those situations
  // rather than inventing a state — mid-job this is not an error, it is the
  // normal shape of a job with a deposit, and it becomes actionable when the
  // work is done.
  const balanceUninvoiced = !unpaid && depositOnly;

  const invoiceSituation: Situation = jobClosed
    ? "paid"
    : unpaid && isInvoiceOverdue(unpaid, now)
      ? "invoice_overdue"
      : "invoice_unpaid";

  if (contract?.status === "signed") {
    if (invoices.length === 0 || balanceUninvoiced) {
      // Work completed but no invoice raised yet — the new work_complete state.
      if (workCompletedAt) return { situation: "work_complete", move: "contractor" };
      return { situation: "signed_need_invoice", move: "contractor" };
    }
    return { situation: invoiceSituation, move: jobClosed ? "none" : "customer" };
  }
  if (contract?.status === "sent") return { situation: "contract_sent", move: "customer" };

  // Accepted with no contract yet. If the contractor has already skipped
  // straight to invoicing, follow the invoice; otherwise the contract is next.
  if (invoices.length > 0 && !balanceUninvoiced) {
    return { situation: invoiceSituation, move: jobClosed ? "none" : "customer" };
  }
  return { situation: "accepted_need_contract", move: "contractor" };
};

export const deriveStages = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  currentStage: StageKey | null,
  workCompletedAt: string | null = null,
): { stages: Stage[]; inconsistentStages: StageKey[] } => {
  const quoteDeclined = quote?.status === "declined";
  const contractDeclined = contract?.status === "declined";
  const paidInvoice =
    invoices.find((invoice) => invoice.status === "paid" || invoice.paid_at !== null) ?? null;
  const firstInvoice = [...invoices].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0];

  // THE SAME DEPOSIT RULE deriveSituation applies, applied here too.
  //
  // #739 put that rule on the job's situation and the badge and headline
  // followed it. These two rows did not, so a job with a settled £360 deposit
  // showed "Raise an invoice to get paid" as its headline and, directly below
  // it, ✓ Invoiced and ✓ Paid. One screen contradicting itself, reported
  // 13 Sep — and on a live job, ✓ Invoiced 8 Sept over ✓ Paid 7 Sept against a
  // £72 deposit on £7,200.
  //
  // `invoices.length > 0` and `!!paidInvoice` are both true the instant a
  // deposit settles. A deposit is partial by definition: it neither invoices
  // the job nor pays it, so until a closing invoice exists beside it, neither
  // row is complete. Tested on the invoice TYPE, needing no figures, exactly as
  // the situation rule is.
  // A 100% deposit is the whole job — see the note beside the situation-level
  // check, which this mirrors.
  const depositIsWholeJob = (contract?.deposit_pct ?? 0) >= 100;
  // NOT `settledDeposit && …`. Requiring the deposit to be PAID made both rows
  // below non-monotonic: a raised deposit ticked Invoiced and then UN-ticked the
  // moment the customer paid it, flipping the headline back to "Raise an invoice
  // to get paid" on a job already invoiced and already part-paid (reported
  // 15 Sep). Whether the job is only-a-deposit is a fact about which invoices
  // exist, not about whether money has arrived, so paying one cannot change it.
  const depositOnly =
    !depositIsWholeJob &&
    invoices.length > 0 &&
    invoices.every((i) => i.invoice_type === "deposit");

  const completion: Record<StageKey, { complete: boolean; declined: boolean; date: string | null }> = {
    quote_sent: {
      // Evidence first, status second. `status !== "draft"` ticked an ARCHIVED
      // quote that was never sent, producing "✓ Quote sent" with no date beside
      // it — the tick came from the status, the missing date from the truth.
      // A sent_at stamp settles it; otherwise only a status that is itself
      // downstream of sending counts, which keeps legacy rows with no stamp
      // ticked as they were.
      complete: !!quote && (!!quote.sent_at || !DRAFT_OR_WITHDRAWN.has(quote.status)),
      declined: false,
      date: quote?.sent_at ?? null,
    },
    accepted: {
      complete: quote?.status === "accepted" || !!quote?.accepted_at,
      declined: quoteDeclined,
      date: quote?.accepted_at ?? null,
    },
    contract_signed: {
      complete: contract?.status === "signed",
      declined: contractDeclined,
      date: contract?.signed_at ?? null,
    },
    work_complete: {
      complete: !!workCompletedAt,
      declined: false,
      date: workCompletedAt,
    },
    invoiced: {
      // AN INVOICE EXISTS. That is the whole question this row answers, and a
      // deposit invoice is an invoice: it was raised, emailed, given a due
      // date, and the 08:00 chaser is attached to it.
      //
      // It used to read `invoices.length > 0 && !depositOnly`, which denied one
      // that had definitely been issued. Reported 15 Sep on three jobs, each
      // showing all of this on ONE screen: the tracker "○ Invoiced" with no
      // date, the Invoices panel "Deposit · £756.00 — Due 22 Sept", and the
      // P&L "Invoiced (net) £630.00". Three surfaces, and this was the one
      // that was wrong. A contractor reading the tracker re-issues an invoice
      // the customer already has.
      //
      // The pull the other way is real and is answered by `paid` below, not
      // here: a deposit does not CLOSE a job, and nothing in this change lets
      // a settled deposit tick Paid. Conflating "invoiced at all" with
      // "invoiced in full" is what produced the defect — the row says an
      // invoice went out, and the status panel beside it says what is still
      // owed.
      complete: invoices.length > 0,
      declined: false,
      date: firstInvoice?.created_at ?? null,
    },
    paid: {
      // Nothing outstanding, as well as not deposit-only. `paidInvoice` is a
      // `.find()`, so on a job that took a deposit it returns the DEPOSIT — and
      // without this a settled deposit beside an outstanding final invoice
      // ticked Paid while the balance was still owed. The same "first settled
      // invoice" shape as the paid-card defect reported 13 Sep.
      complete: !!paidInvoice && !depositOnly && !firstUnpaid(invoices),
      declined: false,
      date: paidInvoice?.paid_at ?? null,
    },
  };

  // Monotonic enforcement: a completed later stage implies every earlier
  // stage is complete too. Real rows can break this — e.g. a contractor who
  // raises an invoice before the contract is signed leaves `invoiced`
  // complete while `contract_signed` isn't, which would render a ticked
  // stage sitting after an empty circle. We treat the furthest stage reached
  // as the truth and back-fill the earlier ones, recording which we forced so
  // the caller can log the underlying data inconsistency.
  const lastCompleteIndex = STAGE_ORDER.reduce(
    (last, key, i) => (completion[key].complete ? i : last),
    -1,
  );
  const inconsistentStages: StageKey[] = [];

  const stages = STAGE_ORDER.map((key, index) => {
    const info = completion[key];
    let state: StageState;
    // work_complete is an optional manually-marked milestone, not subject to
    // monotonic enforcement. A contractor can invoice without explicitly marking
    // work complete, and that's not an inconsistency.
    if (index < lastCompleteIndex && !info.complete && key !== "work_complete") {
      inconsistentStages.push(key);
      state = "forced";
    } else if (info.declined && !info.complete) state = "declined";
    else if (info.complete) state = "complete";
    else if (key === currentStage) state = "current";
    else state = "future";
    return { key, label: STAGE_LABELS[key], state, date: info.date };
  });

  return { stages, inconsistentStages };
};

export const deriveJobState = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  now = Date.now(),
  workCompletedAt: string | null = null,
  paymentStages: PaymentStageState[] = [],
): JobState => {
  const { situation, move } = deriveSituation(quote, contract, invoices, now, workCompletedAt, paymentStages);
  const { stages, inconsistentStages } = deriveStages(
    quote,
    contract,
    invoices,
    CURRENT_STAGE[situation],
    workCompletedAt,
  );
  let overallStatus = SITUATION_STATUS[situation];
  if (situation === "quote_sent" && quote?.viewed_at) overallStatus = "Viewed";

  // Compute a stable dedupe key for telemetry. Sort the forced stages to ensure
  // the key is consistent regardless of internal ordering, then join with a
  // delimiter. Null when no stages were forced.
  const inconsistencyKey =
    inconsistentStages.length > 0
      ? [...inconsistentStages].sort().join(",")
      : null;

  return {
    situation,
    move,
    overallStatus,
    stages,
    inconsistentStages,
    activeInvoice: firstUnpaid(invoices),
    contract,
    inconsistencyKey,
  };
};

export const buildTimeline = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  workCompletedAt: string | null = null,
): TimelineEvent[] => {
  const events: TimelineEvent[] = [];

  if (quote?.sent_at) events.push({ label: "Quote sent", at: quote.sent_at });
  if (quote?.viewed_at) events.push({ label: "Quote viewed", at: quote.viewed_at });
  if (quote?.accepted_at) events.push({ label: "Quote accepted", at: quote.accepted_at });
  if (quote?.declined_at) events.push({ label: "Quote declined", at: quote.declined_at });
  if (contract?.sent_at) events.push({ label: "Contract sent", at: contract.sent_at });
  if (contract?.signed_at) events.push({ label: "Contract signed", at: contract.signed_at });
  if (workCompletedAt) events.push({ label: "Work marked complete", at: workCompletedAt });

  for (const invoice of invoices) {
    const typeLabel = invoice.invoice_type === "deposit" ? "Deposit invoice" : "Invoice";
    events.push({ label: `${typeLabel} sent`, at: invoice.created_at });
    for (const chase of invoice.chase_events ?? []) {
      // The cap marker isn't a customer contact — it records that automatic
      // reminders were stopped after the maximum number of attempts.
      if (chase.channel === "cap") {
        events.push({ label: "Reminders stopped after 4 attempts", at: chase.sent_at });
      } else {
        events.push({ label: `Chased by ${chase.channel}`, at: chase.sent_at });
      }
    }
    if (invoice.paid_at) events.push({ label: `${typeLabel} paid`, at: invoice.paid_at });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};
