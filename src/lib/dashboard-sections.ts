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
): DashboardSection => {
  const { situation } = deriveSituation(quote, contract, invoices, now);
  if (situation === "accepted_need_contract") return "awaiting_contract";
  // Deliberately NOT "any accepted quote with no invoice". A signature is what
  // makes the terms enforceable, so it is the gate for offering an invoice at
  // all; `signed_need_invoice` is the only situation that carries one.
  if (situation === "signed_need_invoice") return "awaiting_invoice";
  return null;
};
