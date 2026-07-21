// Pure derivation of a job's position in the quote → paid pipeline. All state
// is read from existing quote/contract/invoice rows — no new state storage.
// The job detail page (/jobs/[id]) renders the returned stages, "whose move"
// situation and activity timeline from this single source of truth.

import type { StatusLabel } from "@/components/ui/status-chip";

export type StageKey = "quote_sent" | "accepted" | "contract_signed" | "invoiced" | "paid";
export type StageState = "complete" | "current" | "future" | "declined";
export type Stage = { key: StageKey; label: string; state: StageState; date: string | null };

// Exactly what needs to happen next, and whose job it is. The page maps each
// situation to human copy + at most one primary action.
export type Situation =
  | "draft_quote"
  | "quote_sent"
  | "quote_declined"
  | "accepted_need_contract"
  | "contract_sent"
  | "contract_declined"
  | "signed_need_invoice"
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
  activeInvoice: InvoiceState | null;
  contract: ContractState;
};

export type TimelineEvent = { label: string; at: string };

const STAGE_LABELS: Record<StageKey, string> = {
  quote_sent: "Quote sent",
  accepted: "Accepted",
  contract_signed: "Contract signed",
  invoiced: "Invoiced",
  paid: "Paid",
};

const STAGE_ORDER: StageKey[] = ["quote_sent", "accepted", "contract_signed", "invoiced", "paid"];

// The stage whose action is pending for a given situation. null = the pipeline
// has stopped (terminal: paid, or declined).
const CURRENT_STAGE: Record<Situation, StageKey | null> = {
  draft_quote: "quote_sent",
  quote_sent: "accepted",
  quote_declined: null,
  accepted_need_contract: "contract_signed",
  contract_sent: "contract_signed",
  contract_declined: null,
  signed_need_invoice: "invoiced",
  invoice_unpaid: "paid",
  invoice_overdue: "paid",
  paid: null,
};

const SITUATION_STATUS: Record<Situation, StatusLabel> = {
  draft_quote: "Draft",
  quote_sent: "Sent",
  quote_declined: "Declined",
  accepted_need_contract: "Accepted",
  contract_sent: "Awaiting signature",
  contract_declined: "Declined",
  signed_need_invoice: "Signed",
  invoice_unpaid: "Awaiting payment",
  invoice_overdue: "Overdue",
  paid: "Paid",
};

export const isInvoiceOverdue = (invoice: InvoiceState, now = Date.now()): boolean =>
  invoice.status !== "paid" &&
  invoice.due_date !== null &&
  new Date(invoice.due_date).getTime() < now;

const firstUnpaid = (invoices: InvoiceState[]): InvoiceState | null =>
  invoices.find((invoice) => invoice.status !== "paid") ?? null;

export const deriveSituation = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  now = Date.now(),
): { situation: Situation; move: NextMove } => {
  if (!quote || quote.status === "draft") return { situation: "draft_quote", move: "contractor" };
  if (quote.status === "sent") return { situation: "quote_sent", move: "customer" };
  if (quote.status === "declined") return { situation: "quote_declined", move: "none" };

  // Quote is accepted from here on.
  if (contract?.status === "declined") return { situation: "contract_declined", move: "none" };

  const unpaid = firstUnpaid(invoices);
  const invoiceSituation: Situation = unpaid
    ? isInvoiceOverdue(unpaid, now)
      ? "invoice_overdue"
      : "invoice_unpaid"
    : "paid";

  if (contract?.status === "signed") {
    if (invoices.length === 0) return { situation: "signed_need_invoice", move: "contractor" };
    return { situation: invoiceSituation, move: unpaid ? "customer" : "none" };
  }
  if (contract?.status === "sent") return { situation: "contract_sent", move: "customer" };

  // Accepted with no contract yet. If the contractor has already skipped
  // straight to invoicing, follow the invoice; otherwise the contract is next.
  if (invoices.length > 0) return { situation: invoiceSituation, move: unpaid ? "customer" : "none" };
  return { situation: "accepted_need_contract", move: "contractor" };
};

export const deriveStages = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  currentStage: StageKey | null,
): Stage[] => {
  const quoteDeclined = quote?.status === "declined";
  const contractDeclined = contract?.status === "declined";
  const paidInvoice =
    invoices.find((invoice) => invoice.status === "paid" || invoice.paid_at !== null) ?? null;
  const firstInvoice = [...invoices].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )[0];

  const completion: Record<StageKey, { complete: boolean; declined: boolean; date: string | null }> = {
    quote_sent: {
      complete: !!quote && quote.status !== "draft",
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
    invoiced: {
      complete: invoices.length > 0,
      declined: false,
      date: firstInvoice?.created_at ?? null,
    },
    paid: {
      complete: !!paidInvoice,
      declined: false,
      date: paidInvoice?.paid_at ?? null,
    },
  };

  return STAGE_ORDER.map((key) => {
    const info = completion[key];
    let state: StageState;
    if (info.declined && !info.complete) state = "declined";
    else if (info.complete) state = "complete";
    else if (key === currentStage) state = "current";
    else state = "future";
    return { key, label: STAGE_LABELS[key], state, date: info.date };
  });
};

export const deriveJobState = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  now = Date.now(),
): JobState => {
  const { situation, move } = deriveSituation(quote, contract, invoices, now);
  const stages = deriveStages(quote, contract, invoices, CURRENT_STAGE[situation]);
  let overallStatus = SITUATION_STATUS[situation];
  if (situation === "quote_sent" && quote?.viewed_at) overallStatus = "Viewed";

  return {
    situation,
    move,
    overallStatus,
    stages,
    activeInvoice: firstUnpaid(invoices),
    contract,
  };
};

export const buildTimeline = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
): TimelineEvent[] => {
  const events: TimelineEvent[] = [];

  if (quote?.sent_at) events.push({ label: "Quote sent", at: quote.sent_at });
  if (quote?.viewed_at) events.push({ label: "Quote viewed", at: quote.viewed_at });
  if (quote?.accepted_at) events.push({ label: "Quote accepted", at: quote.accepted_at });
  if (quote?.declined_at) events.push({ label: "Quote declined", at: quote.declined_at });
  if (contract?.sent_at) events.push({ label: "Contract sent", at: contract.sent_at });
  if (contract?.signed_at) events.push({ label: "Contract signed", at: contract.signed_at });

  for (const invoice of invoices) {
    const typeLabel = invoice.invoice_type === "deposit" ? "Deposit invoice" : "Invoice";
    events.push({ label: `${typeLabel} sent`, at: invoice.created_at });
    for (const chase of invoice.chase_events ?? []) {
      events.push({ label: `Chased by ${chase.channel}`, at: chase.sent_at });
    }
    if (invoice.paid_at) events.push({ label: `${typeLabel} paid`, at: invoice.paid_at });
  }

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};
