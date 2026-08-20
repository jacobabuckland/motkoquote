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

// The trade's own fee statement: what's accrued and awaiting the next monthly
// collection, and the history of past collections — each with its VAT-inclusive
// net/VAT breakdown. Reads only (RLS owner-read on jobs + fee_collections).
// Rendered only when fee billing is switched on (gated in settings/page.tsx),
// so nothing about fees appears before go-live.
export const FeesStatementSection = async ({ contractorId }: Props) => {
  const supabase = await createClient();

  const [{ data: accruedRows }, { data: atSourceRows }, { data: collectionRows }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("fee_amount_pennies, fee_net_pennies, fee_vat_pennies")
        .eq("contractor_id", contractorId)
        .eq("fee_status", "accrued"),
      // Fees Stripe already took out of the payment (PAY-4). These owe nothing,
      // so they must never join the accrued total — but they are real charges
      // the trade paid, so the statement has to account for them. paid_at is the
      // collection date: the fee left with the payment, at the same instant.
      supabase
        .from("jobs")
        .select("id, fee_amount_pennies, fee_net_pennies, fee_vat_pennies, paid_at")
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
    }[]).map<AccruedFeeJob>((j) => ({
      feeAmountPennies: j.fee_amount_pennies ?? 0,
      netPennies: j.fee_net_pennies ?? 0,
      vatPennies: j.fee_vat_pennies ?? 0,
    })),
  );

  const atSource = (atSourceRows ?? []) as AtSourceFeeRow[];
  const atSourceTotals = summariseAccruedFees(
    atSource.map<AccruedFeeJob>((j) => ({
      feeAmountPennies: j.fee_amount_pennies ?? 0,
      netPennies: j.fee_net_pennies ?? 0,
      vatPennies: j.fee_vat_pennies ?? 0,
    })),
  );

  const collections = (collectionRows ?? []) as CollectionRow[];

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Motko fees</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Our fee is £2 per paid job (£4 over £1,000), taken out of each payment
        when it settles. The £2/£4 is VAT-inclusive — the net and VAT are shown
        below.
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

        {/* Legacy only: jobs settled before fees moved to source, and any job
            marked paid by hand. Nothing collects these automatically now, so
            they are shown as outstanding rather than scheduled. */}
        {accrued.jobCount > 0 && (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">
              Outstanding — not taken at source
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatGBP(accrued.grossPennies / 100)}
            </p>
            <p className="text-xs text-text-secondary">
              {accrued.jobCount} paid job{accrued.jobCount === 1 ? "" : "s"} · net{" "}
              {formatGBP(accrued.netPennies / 100)} + VAT {formatGBP(accrued.vatPennies / 100)}
            </p>
          </div>
        )}

        {atSource.length > 0 && (
          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-secondary">
              Fees taken at payment
            </p>
            <ul className="space-y-3">
              {atSource.map((j) => (
                <li key={j.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {j.paid_at ? formatDate(j.paid_at) : "Paid"}
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
              ))}
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
