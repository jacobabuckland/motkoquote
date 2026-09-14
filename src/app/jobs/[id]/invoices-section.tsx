import { Card } from "@/components/ui/card";
import { InlineLink } from "@/components/ui/inline-link";
import { ShareLinkButton } from "@/components/ui/share-link-button";
import { formatDate, formatGBP } from "@/lib/format";

/**
 * Every invoice this job has raised, and a way back to each one.
 *
 * Reported 14 Sep: enumerating every anchor on a settled job page returned ZERO
 * hrefs containing `/i/`. Once paid, the invoices a trade raised were
 * unreachable — no list, no amounts, no payment link, no way to re-send. The
 * only trace left was two lines in the Activity feed reading "Deposit invoice
 * sent" and "Invoice paid", which say that something happened and nothing about
 * what it was for.
 *
 * That is the trade's own record of what they billed, and it is also the reason
 * a defect on the customer's copy of the invoice stays invisible to them: they
 * cannot open the page their customer is looking at.
 *
 * Deliberately shown at EVERY state, not only when settled. The payment link
 * for an outstanding invoice already appears in the next-step panel above, but
 * that panel shows one invoice — the active one — and a job with a deposit and
 * a balance has two. This is the full list, oldest first, which is the order
 * they were raised and the order they read in.
 */
export type JobInvoice = {
  id: string;
  amount: number;
  status: string;
  invoice_type: string;
  due_date: string | null;
  created_at: string;
  paid_at: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  final: "Final",
  stage: "Stage",
};

// Plain text rather than a StatusChip: that component takes a constrained
// StatusLabel union and these are dates, not statuses.
const describe = (invoice: JobInvoice): string => {
  if (invoice.status === "paid") {
    return invoice.paid_at ? `Paid ${formatDate(invoice.paid_at)}` : "Paid";
  }
  if (invoice.status === "void" || invoice.status === "cancelled") return "Cancelled";
  return invoice.due_date ? `Due ${formatDate(invoice.due_date)}` : "Awaiting payment";
};

export const InvoicesSection = ({
  invoices,
  appUrl,
  customerFirstName,
}: {
  invoices: JobInvoice[];
  appUrl: string;
  customerFirstName: string;
}) => {
  if (invoices.length === 0) return null;

  // Oldest first: a deposit precedes its balance, and reading them in the order
  // they were raised is how the trade reconstructs what the customer received.
  const ordered = [...invoices].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        Invoices
      </h2>
      <ul className="flex flex-col gap-3">
        {ordered.map((invoice) => {
          const url = `${appUrl}/i/${invoice.id}`;
          const state = describe(invoice);
          return (
            <li
              key={invoice.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {TYPE_LABEL[invoice.invoice_type] ?? "Invoice"} · {formatGBP(invoice.amount)}
                </span>
                <span className="text-xs text-text-secondary">{state}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {/* The same URL the customer holds. `external` because it is
                    the public document, not a page of the app's own. */}
                <InlineLink href={url} external>
                  View invoice
                </InlineLink>
                <ShareLinkButton
                  url={url}
                  title={`Invoice for ${customerFirstName}`}
                  label="Copy link"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};
