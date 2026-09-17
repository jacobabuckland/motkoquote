// Pure derivation of a job's position in the quote → paid pipeline. All state
// is read from existing quote/contract/invoice rows — no new state storage.
// The job detail page (/jobs/[id]) renders the returned stages, "whose move"
// situation and activity timeline from this single source of truth.

import type { StatusLabel } from "@/components/ui/status-chip";
import { isDateOverdue } from "@/lib/overdue";
import { coversWholeJob, poundsToPennies, resolveDeposit } from "@/lib/quote-deposit";
import { formatGBP } from "@/lib/format";

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
  /**
   * The quote's own total and recorded deposit (migration 81).
   *
   * OPTIONAL, and omission means "not supplied" rather than zero — see
   * depositIsWholeJob below, where absence falls back to the contract
   * percentage exactly as this file behaved before they existed. Every caller
   * that does not pass them keeps its current answer.
   */
  total?: number | null;
  deposit_pennies?: number | null;
  /**
   * When the customer FIRST accepted (migration 82), and never cleared.
   *
   * `accepted_at` above is the CURRENT state and a re-issue clears it —
   * correctly, or the job reads as accepted while awaiting a second acceptance.
   * The timeline reading that same column is what made an acceptance stop
   * having happened. This is the one the history reads.
   */
  accepted_first_at?: string | null;
  /**
   * WHAT the customer accepted, beside WHEN (migration 84).
   *
   * `total` is overwritten by a re-issue; this is not. Without it the Activity
   * panel says "Quote accepted" on a quote now reading £840.00 when £600.00 was
   * what was agreed — evidence pointing the wrong way, which in a dispute is
   * worse than the missing entry migration 82 fixed.
   *
   * Optional, and absence means "not recorded": every quote accepted before
   * migration 84, and every caller not yet passing it, keeps today's wording.
   */
  accepted_total?: number | null;
  /**
   * When the quote was last re-issued after acceptance (migration 84).
   *
   * The panel is a projection of row state, so an event with no surviving
   * timestamp never happened. `announceReissue` has always carried a comment
   * saying this entry belongs here and then sent the event to `track()` — an
   * analytics sink the timeline cannot read.
   */
  reissued_at?: string | null;
} | null;

export type ContractState = {
  id: string;
  status: string;
  sent_at: string | null;
  signed_at: string | null;
  // Written by migration 49 and populated on every decline. It was simply never
  // carried here, so buildTimeline had nothing to push and a declined contract
  // left no trace in the Activity panel at all — the customer's decision, the
  // one thing a contractor most wants a date for, missing from the history.
  //
  // Optional so every existing caller that builds a ContractState without it
  // keeps compiling and keeps its current behaviour: absent means "not
  // declined", which is what those callers were already saying.
  declined_at?: string | null;
  /**
   * When the contractor withdrew this contract (migration 82). Optional for the
   * same reason as declined_at: every existing caller keeps compiling and keeps
   * its behaviour, and absence reads as "not withdrawn".
   */
  withdrawn_at?: string | null;
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

/**
 * Does the deposit cover the entire job?
 *
 * A 100% deposit IS the whole job, and the two rules below both need to know:
 * a job paid entirely up front is finished, not "awaiting its balance".
 *
 * THIS READ THE CONTRACT PERCENTAGE ALONE until 15 Sep, and #722 moved deposits
 * to `quotes.deposit_pennies`. So a 100% deposit agreed on the QUOTE left
 * `deposit_pct` null, this answered false, and the job was treated as
 * deposit-only for ever: the tracker stopped one tick short at "Paid ○", the
 * headline asked for an invoice, the only offered action refused with "This
 * quote is already fully invoiced", and the dashboard filed a fully paid job
 * under "accepted quotes awaiting invoice". Reported 15 Sep on a £1,481.48 job
 * paid in full. A regression introduced by the deposit work, not a gap in it.
 *
 * It now asks the ONE resolver, so this answer and the invoice actually raised
 * at signature come from the same rule. Compared in PENCE, against the quote's
 * own total — the contractor's stated split either covers the job or it does
 * not, which is the same kind of comparison the percentage always made.
 *
 * WITHOUT a quote total it falls back to the percentage, so every caller that
 * does not supply one keeps the behaviour it had. Absence is not zero here:
 * answering "the deposit is the whole job" on missing data would close jobs
 * that are not paid, which is the more expensive direction to be wrong in.
 */
const depositIsWholeJob = (quote: QuoteState, contract: ContractState): boolean => {
  const total = quote?.total;
  if (total != null && total > 0) {
    const resolved = resolveDeposit(
      { total, deposit_pennies: quote?.deposit_pennies },
      { deposit_pct: contract?.deposit_pct ?? null },
    );
    if (resolved) return coversWholeJob(resolved.pennies, poundsToPennies(total));
  }
  return (contract?.deposit_pct ?? 0) >= 100;
};

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
  // The pipeline has NOT stopped: a declined contract sends the job back to
  // needing one, which is the stage the contractor acts on.
  contract_declined: "contract_signed",
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
  archivedAt: string | null = null,
): { situation: Situation; move: NextMove } => {
  // Job-level archive takes precedence: a job archived via archived_at is
  // archived regardless of its quote status. Both mechanisms produce the same
  // outcome — the job reads as filed away and offers restoration.
  if (archivedAt) return { situation: "quote_archived", move: "none" };

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
  // "none" said the job was over. It is not: the customer refused THIS
  // contract, and the contractor's next move is to correct the quote and send
  // another. Pass 12 found the dead end — "Nothing needs you here", with archive
  // as the only exit — and it is the same class as the awaiting-invoice
  // purgatory that #774 closed.
  if (contract?.status === "declined") {
    return { situation: "contract_declined", move: "contractor" };
  }

  // A WITHDRAWN contract is treated as if no contract exists — the job returns
  // to "accepted, need contract" rather than stuck waiting for a signature that
  // will never come. This puts the contractor back in control to re-send a
  // corrected contract after withdrawal.
  const activeContract = contract?.status === "withdrawn" ? null : contract;

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
  const depositOnly =
    settledDeposit && !hasClosingInvoice && !depositIsWholeJob(quote, activeContract);

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

  if (activeContract?.status === "signed") {
    if (invoices.length === 0 || balanceUninvoiced) {
      // Work completed but no invoice raised yet — the new work_complete state.
      if (workCompletedAt) return { situation: "work_complete", move: "contractor" };
      return { situation: "signed_need_invoice", move: "contractor" };
    }
    return { situation: invoiceSituation, move: jobClosed ? "none" : "customer" };
  }
  if (activeContract?.status === "sent") return { situation: "contract_sent", move: "customer" };

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
  // A withdrawn contract is treated as no contract for stage derivation
  const activeContract = contract?.status === "withdrawn" ? null : contract;

  const quoteDeclined = quote?.status === "declined";
  const contractDeclined = activeContract?.status === "declined";
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
  // A 100% deposit is the whole job — one shared helper now, so the two rules
  // cannot drift apart the way the deposit sources did.
  // NOT `settledDeposit && …`. Requiring the deposit to be PAID made both rows
  // below non-monotonic: a raised deposit ticked Invoiced and then UN-ticked the
  // moment the customer paid it, flipping the headline back to "Raise an invoice
  // to get paid" on a job already invoiced and already part-paid (reported
  // 15 Sep). Whether the job is only-a-deposit is a fact about which invoices
  // exist, not about whether money has arrived, so paying one cannot change it.
  const depositOnly =
    !depositIsWholeJob(quote, activeContract) &&
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
      complete: activeContract?.status === "signed",
      declined: contractDeclined,
      date: activeContract?.signed_at ?? null,
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
  archivedAt: string | null = null,
): JobState => {
  const { situation, move } = deriveSituation(quote, contract, invoices, now, workCompletedAt, paymentStages, archivedAt);
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
  /**
   * EVERY contract on the quote, not just the current one — pass-14 SERIOUS 2.
   *
   * `contract` is a single row, so a quote that had three contracts showed the
   * events of one. Pass 14 watched "Contract sent 13:32" and "Contract
   * withdrawn 13:34" DISAPPEAR the moment a replacement went out, leaving a log
   * asserting that one contract was sent after the re-issue and signed. The
   * history did not merely go missing; what remained was false.
   *
   * Nothing new is stored. Every contract row already carries its own
   * `sent_at`, `withdrawn_at`, `declined_at` and `signed_at` — migration 83
   * simply made more than one of those rows able to exist, and this reads them
   * all. That is why SERIOUS 2 needs no migration and SERIOUS 3 does: the
   * contract lifecycle has always had somewhere to live, and a second
   * acceptance never has.
   *
   * Optional, and absent it falls back to `[contract]`, so every existing
   * caller keeps producing exactly the timeline it produces today.
   */
  contracts?: ContractState[],
): TimelineEvent[] => {
  // A withdrawn contract still appears in the timeline — withdrawal is an event
  // the contractor took, and its history belongs in the Activity panel. We just
  // don't let it block the pipeline.
  const events: TimelineEvent[] = [];

  if (quote?.sent_at) events.push({ label: "Quote sent", at: quote.sent_at });
  if (quote?.viewed_at) events.push({ label: "Quote viewed", at: quote.viewed_at });
  // THE HISTORY, not the current state.
  //
  // `accepted_first_at` survives a re-issue; `accepted_at` does not. Falling
  // back to `accepted_at` keeps every quote accepted before migration 82 — and
  // every caller that does not carry the new field — reading exactly as it does
  // today, rather than silently losing an entry it used to show.
  const acceptedAt = quote?.accepted_first_at ?? quote?.accepted_at;
  if (acceptedAt) {
    // Naming the figure is the whole of pass-13 SERIOUS 3. "Quote accepted" on
    // a quote that now reads £840.00 asserts they agreed to £840.00; they
    // agreed to £600.00. Where the amount was never recorded the label stays
    // exactly as it is today rather than guessing from `total`, which after a
    // re-issue is the NEW figure wearing the old one's clothes.
    const acceptedTotal = quote?.accepted_total;
    events.push({
      label:
        typeof acceptedTotal === "number"
          ? `Quote accepted — ${formatGBP(acceptedTotal)}`
          : "Quote accepted",
      at: acceptedAt,
    });
  }
  if (quote?.reissued_at) {
    events.push({ label: "Quote re-issued", at: quote.reissued_at });
  }
  if (quote?.declined_at) events.push({ label: "Quote declined", at: quote.declined_at });
  // One entry per contract, per thing that happened to it. Three contracts and
  // two withdrawals is six dated rows, which is what actually happened; before
  // this it was one row, which was not.
  const contractRows = contracts ?? [contract];
  for (const row of contractRows) {
    if (row?.sent_at) events.push({ label: "Contract sent", at: row.sent_at });
    if (row?.signed_at) events.push({ label: "Contract signed", at: row.signed_at });
    if (row?.declined_at) events.push({ label: "Contract declined", at: row.declined_at });
    if (row?.withdrawn_at) {
      events.push({ label: "Contract withdrawn", at: row.withdrawn_at });
    }
  }
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
