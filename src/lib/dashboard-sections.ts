// Which dashboard action section a job belongs in.
//
// The dashboard used to answer this with two independent row-count filters —
// `invoices.length === 0` for one section, `contracts.length === 0` for the
// other — and neither consulted contract STATUS. An accepted quote whose
// contract was sent but unsigned satisfied both: it appeared under "Accepted
// quotes awaiting invoice", offering a Final invoice one tap from sending, and
// under "Contracts awaiting signature" at the same time. One job, two
// contradictory states, each offering an action pointing the other way.
//
// job-stages.ts could always answer it — `contract_sent` is a situation it
// derives, and /jobs/[id] renders it correctly. The dashboard simply never
// asked. This module is that question, kept pure so the "exactly one section"
// invariant is bound by a test rather than by reading two filters and hoping.

import { deriveSituation, type ContractState, type InvoiceState, type QuoteState } from "@/lib/job-stages";

/**
 * The action sections the dashboard offers for a job it holds. `null` means the
 * job is not awaiting a contractor action in either of them — it is somewhere
 * else in the pipeline (out for signature, invoiced, paid, declined) and is
 * listed by whichever query owns that state.
 */
export type DashboardSection = "awaiting_contract" | "awaiting_invoice" | null;

export const dashboardSection = (
  quote: QuoteState,
  contract: ContractState,
  invoices: InvoiceState[],
  now = Date.now(),
  workCompletedAt: string | null = null,
  archivedAt: string | null = null,
): DashboardSection => {
  const { situation } = deriveSituation(quote, contract, invoices, now, workCompletedAt, [], archivedAt);
  if (situation === "accepted_need_contract") return "awaiting_contract";
  // Deliberately NOT "any accepted quote with no invoice". A signature is what
  // makes the terms enforceable, so it is the gate for offering an invoice at
  // all; `signed_need_invoice` is the only situation that carries one.
  if (situation === "signed_need_invoice") return "awaiting_invoice";
  // Work complete but not invoiced yet — the next action is the invoice, which
  // is the gating item's call (#419), not this one's.
  if (situation === "work_complete") return null;
  return null;
};

/**
 * The dashboard's row, mapped to the question above.
 *
 * This mapping lives here rather than in the page because the page got it
 * wrong and nothing could see it. `dashboardSection` is pure and was correct
 * throughout; the dashboard simply handed it fewer arguments than
 * `/jobs/[id]` did, so the two surfaces answered differently for the same job.
 *
 * What that cost: #780 taught the situation resolver to settle a 100% deposit
 * from the quote's own total, because `contracts.deposit_pct` is null on every
 * deposit agreed on the quote. The job page passed `total` and
 * `deposit_pennies`; the dashboard did not, fell back to that null percentage,
 * and filed a job PAID IN FULL under "accepted quotes awaiting invoice" — with
 * a Final invoice for the whole job value pre-filled and one click from
 * sending. Reported 15 Sep on a £2,880 job whose own page read "Paid — nothing
 * else needs you" at the same moment.
 *
 * Taking the row whole means a future field is added in one place, and the
 * invariant that both surfaces agree can be bound by a test rather than by
 * remembering to pass an argument.
 */
export type DashboardQuoteRow = {
  status: string;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  total: number | null;
  deposit_pennies: number | null;
  contract: ContractState;
  invoices: InvoiceState[];
  work_completed_at: string | null;
};

export const sectionForQuoteRow = (row: DashboardQuoteRow, now = Date.now()): DashboardSection =>
  dashboardSection(
    {
      status: row.status,
      sent_at: row.sent_at,
      viewed_at: row.viewed_at,
      accepted_at: row.accepted_at,
      declined_at: row.declined_at,
      total: row.total,
      deposit_pennies: row.deposit_pennies,
    },
    row.contract,
    row.invoices,
    now,
    row.work_completed_at,
  );
