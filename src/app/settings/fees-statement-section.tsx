import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { formatGBP, formatDate } from "@/lib/format";
import { summariseAccruedFees, type AccruedFeeJob } from "@/lib/fee-statement";

type Props = {
  contractorId: string;
};

type AtSourceFeeRow = {
  id: string;
  fee_amount_pennies: number | null;
  fee_net_pennies: number | null;
  fee_vat_pennies: number | null;
  paid_at: string | null;
  settlement_state: string | null;
};

type CollectionRow = {
  id: string;
  period_start: string;
  period_end: string;
  total_pennies: number;
  net_pennies: number;
  vat_pennies: number;
  status: string;
  collected_at: string | null;
};

// 'pending' is deliberately NOT "Scheduled": PAY-5 removed the rail these
// batches were to be charged on, so nothing is scheduled and saying otherwise
// promises a collection that cannot happen. These are legacy rows only.
const STATUS_LABEL: Record<string, string> = {
  pending: "Not scheduled",
  collected: "Collected",
  failed: "Retrying",
};

// The trade's own fee statement: what Stripe took out of each payment, what was
// booked against a job the payment never carried, and the history of past
// collections. Reads only (RLS owner-read on jobs + fee_collections).
//
// Two claims that used to sit here are gone because they stopped being true:
// nothing awaits a "next monthly collection" (PAY-5 removed that rail), and the
// section is no longer gated on a fee-billing flag (FEE-3 deleted it) — every
// surface here is honest about the fee and shows unconditionally.
export const FeesStatementSection = async ({ contractorId }: Props) => {
  const supabase = await createClient();

  const [{ data: accruedRows }, { data: atSourceRows }, { data: collectionRows }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("fee_amount_pennies, fee_net_pennies, fee_vat_pennies, settlement_state")
        .eq("contractor_id", contractorId)
        .eq("fee_status", "accrued"),
      // Fees Stripe already took out of the payment (PAY-4). These owe nothing,
      // so they must never join the accrued total — but they are real charges
      // the trade paid, so the statement has to account for them. paid_at is the
      // collection date: the fee left with the payment, at the same instant.
      // FEE-10: fetch settlement_state so reversed settlements can be labelled.
      supabase
        .from("jobs")
        .select("id, fee_amount_pennies, fee_net_pennies, fee_vat_pennies, paid_at, settlement_state")
        .eq("contractor_id", contractorId)
        .eq("fee_status", "collected")
        .order("paid_at", { ascending: false }),
      supabase
        .from("fee_collections")
        .select("id, period_start, period_end, total_pennies, net_pennies, vat_pennies, status, collected_at")
        .eq("contractor_id", contractorId)
        .order("period_start", { ascending: false }),
    ]);

  const accrued = summariseAccruedFees(
    ((accruedRows ?? []) as {
      fee_amount_pennies: number | null;
      fee_net_pennies: number | null;
      fee_vat_pennies: number | null;
      settlement_state: string | null;
    }[]).map<AccruedFeeJob>((j) => ({
      feeAmountPennies: j.fee_amount_pennies ?? 0,
      netPennies: j.fee_net_pennies ?? 0,
      vatPennies: j.fee_vat_pennies ?? 0,
      settlementState: j.settlement_state,
    })),
  );

  const atSource = (atSourceRows ?? []) as AtSourceFeeRow[];
  const atSourceTotals = summariseAccruedFees(
    atSource.map<AccruedFeeJob>((j) => ({
      feeAmountPennies: j.fee_amount_pennies ?? 0,
      netPennies: j.fee_net_pennies ?? 0,
      vatPennies: j.fee_vat_pennies ?? 0,
      settlementState: j.settlement_state,
    })),
  );

  const collections = (collectionRows ?? []) as CollectionRow[];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Motko fees</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Our service fee is a percentage of each payment — 0.3% of the first
        £5,000, 0.2% of the next £5,000 and 0.15% above £10,000, with a £2.00
        minimum and no maximum. It is taken out of each payment when it settles.
        Motko is not registered for VAT, so nothing is added on top; the net and
        VAT figures below describe what was taken rather than adding to it.
      </p>
      {/*
        FEE-10's acceptance criterion: "the fees statement links to or restates
        it". Restating the whole clause here would put four paragraphs of terms
        above a two-line total, so it links — and the link goes to /terms, which
        renders the clause from the same constant the reversal planner uses.
      */}
      <p className="mb-3 text-sm text-text-secondary">
        If a payment is later refunded, the service fee on it is not returned —
        it covers work already done.{" "}
        <a className="underline" href="/terms">
          Contractor terms
        </a>
        .
      </p>
      <Card className="space-y-4">
        <div>
          <p className="text-xs font-medium text-text-secondary">
            Taken from payments
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {formatGBP(atSourceTotals.grossPennies / 100)}
          </p>
          <p className="text-xs text-text-secondary">
            {atSourceTotals.jobCount} paid job
            {atSourceTotals.jobCount === 1 ? "" : "s"} · net{" "}
            {formatGBP(atSourceTotals.netPennies / 100)} + VAT{" "}
            {formatGBP(atSourceTotals.vatPennies / 100)}
          </p>
        </div>

        {/* Fees booked against a job the payment never carried: settled before
            fees moved to source, or marked paid by hand.

            This used to be headed "Outstanding — not taken at source", which to
            a contractor means "you owe this". Nothing in the product collects
            it and nothing is meant to, so the trade was reading a bill that
            will never arrive — a trust defect whether or not the ledger is
            arithmetically right.

            The ledger rows are untouched: they stay `accrued` and remain the
            accounting record of what the fee would have been. Only the words
            change (decision, 2026-08-25).

            The VAT split goes with the old wording. A net/VAT breakdown on an
            amount nobody is charged describes a tax position that does not
            exist, and it was the detail that made the figure read as an invoice.

            Not a fixed historical bucket: every hand-marked-paid job still
            lands here, so the copy must not call it legacy. */}
        {accrued.jobCount > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">
              Recorded, not charged
            </p>
            <p className="text-lg font-semibold tabular-nums text-text-secondary">
              {formatGBP(accrued.grossPennies / 100)}
            </p>
            <p className="text-xs text-text-secondary">
              {accrued.jobCount} paid job{accrued.jobCount === 1 ? "" : "s"} where the
              fee couldn&apos;t come out of the payment — marked paid by hand, or
              settled before fees came out at source. There&apos;s nothing to pay.
            </p>
          </div>
        )}

        {atSource.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">
              Fees taken at payment
            </p>
            <ul className="space-y-3">
              {atSource.map((j) => {
                const isReversed =
                  j.settlement_state === "reversed_after_settlement" ||
                  j.settlement_state === "reversed_before_settlement";
                return (
                  <li key={j.id} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {j.paid_at ? formatDate(j.paid_at) : "Paid"}
                        {isReversed && (
                          <span className="ml-2 text-xs text-text-secondary">
                            · Reversed (kept)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-text-secondary">
                        Taken from payment · net{" "}
                        {formatGBP((j.fee_net_pennies ?? 0) / 100)} + VAT{" "}
                        {formatGBP((j.fee_vat_pennies ?? 0) / 100)}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">
                      {formatGBP((j.fee_amount_pennies ?? 0) / 100)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {collections.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">Collections</p>
            <ul className="space-y-3">
              {collections.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {formatDate(c.period_start)} – {formatDate(c.period_end)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {STATUS_LABEL[c.status] ?? c.status}
                      {c.collected_at ? ` · ${formatDate(c.collected_at)}` : ""} · net{" "}
                      {formatGBP(c.net_pennies / 100)} + VAT {formatGBP(c.vat_pennies / 100)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">
                    {formatGBP(c.total_pennies / 100)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
};
