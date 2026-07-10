import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { CreateInvoiceForm } from "./create-invoice-form";
import { CreateContractForm } from "./create-contract-form";
import { AppHeader } from "@/components/ui/app-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

type AcceptedQuote = {
  id: string;
  total: number;
  accepted_at: string | null;
  job: { customer: { name: string } | null } | null;
  invoices: { id: string }[];
  contracts: { id: string }[];
};

type SentContract = {
  id: string;
  status: string;
  sent_at: string | null;
  quote: { total: number; job: { customer: { name: string } | null } | null } | null;
};

type SentQuote = {
  id: string;
  total: number;
  sent_at: string | null;
  viewed_at: string | null;
  job: { customer: { name: string } | null } | null;
};

type OpenInvoice = {
  id: string;
  amount: number;
  status: string;
  invoice_type: string;
  due_date: string | null;
  stripe_payment_link_url: string | null;
  created_at: string;
  quote: { job: { customer: { name: string } | null } | null } | null;
};

const invoiceTypeLabel: Record<string, string> = {
  deposit: "Deposit",
  final: "Final invoice",
};

const invoiceStatusTone: Record<string, "neutral" | "warning" | "success"> = {
  draft: "neutral",
  sent: "warning",
  paid: "success",
};

const invoiceStatusLabel: Record<string, string> = {
  draft: "Draft",
  sent: "Awaiting payment",
  paid: "Paid",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id, company_name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) redirect("/setup");

  const { data: acceptedQuotesRaw } = await supabase
    .from("quotes")
    .select(
      "id, total, accepted_at, job:jobs(customer:customers(name)), invoices(id), contracts(id)",
    )
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false });

  const acceptedQuotes = (acceptedQuotesRaw ?? []) as unknown as AcceptedQuote[];
  const quotesNeedingInvoice = acceptedQuotes.filter((q) => q.invoices.length === 0);
  const quotesNeedingContract = acceptedQuotes.filter((q) => q.contracts.length === 0);

  const { data: sentContractsRaw } = await supabase
    .from("contracts")
    .select("id, status, sent_at, quote:quotes(total, job:jobs(customer:customers(name)))")
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  const sentContracts = (sentContractsRaw ?? []) as unknown as SentContract[];

  const { data: sentQuotesRaw } = await supabase
    .from("quotes")
    .select("id, total, sent_at, viewed_at, job:jobs(customer:customers(name))")
    .eq("status", "sent")
    .order("sent_at", { ascending: false });

  const sentQuotes = (sentQuotesRaw ?? []) as unknown as SentQuote[];

  const { data: openInvoicesRaw } = await supabase
    .from("invoices")
    .select(
      "id, amount, status, invoice_type, due_date, stripe_payment_link_url, created_at, quote:quotes(job:jobs(customer:customers(name)))",
    )
    .neq("status", "paid")
    .order("created_at", { ascending: false });

  const openInvoices = (openInvoicesRaw ?? []) as unknown as OpenInvoice[];

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Outstanding quotes
          </h2>
          {sentQuotes.length === 0 ? (
            <EmptyState
              title="Nothing waiting on a customer"
              description="Quotes you've sent will show up here until they're viewed or accepted."
            />
          ) : (
            sentQuotes.map((quote) => (
              <Card key={quote.id} className="flex items-center justify-between">
                <span className="text-sm">{quote.job?.customer?.name ?? "Customer"}</span>
                <div className="flex flex-col items-end gap-1">
                  <span className="tabular-nums text-sm font-medium">
                    £{quote.total.toFixed(2)}
                  </span>
                  <Badge tone={quote.viewed_at ? "success" : "neutral"}>
                    {quote.viewed_at ? "Viewed" : "Not viewed yet"}
                  </Badge>
                </div>
              </Card>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Accepted quotes awaiting contract
          </h2>
          {quotesNeedingContract.length === 0 ? (
            <EmptyState title="Nothing waiting here" />
          ) : (
            quotesNeedingContract.map((quote) => (
              <Card key={quote.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{quote.job?.customer?.name ?? "Customer"}</span>
                  <span className="tabular-nums font-medium">
                    £{quote.total.toFixed(2)}
                  </span>
                </div>
                <CreateContractForm quoteId={quote.id} />
              </Card>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Contracts awaiting signature
          </h2>
          {sentContracts.length === 0 ? (
            <EmptyState title="Nothing waiting on a customer" />
          ) : (
            sentContracts.map((contract) => (
              <Card key={contract.id} className="flex items-center justify-between">
                <span className="text-sm">
                  {contract.quote?.job?.customer?.name ?? "Customer"}
                </span>
                <a
                  href={`/c/${contract.id}`}
                  className="text-sm text-accent underline underline-offset-4"
                >
                  View contract
                </a>
              </Card>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Accepted quotes awaiting invoice
          </h2>
          {quotesNeedingInvoice.length === 0 ? (
            <EmptyState title="Nothing waiting here" />
          ) : (
            quotesNeedingInvoice.map((quote) => (
              <Card key={quote.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{quote.job?.customer?.name ?? "Customer"}</span>
                  <span className="tabular-nums font-medium">
                    £{quote.total.toFixed(2)}
                  </span>
                </div>
                <CreateInvoiceForm quoteId={quote.id} quoteTotal={quote.total} />
              </Card>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Unpaid invoices
          </h2>
          {openInvoices.length === 0 ? (
            <EmptyState title="No outstanding invoices" />
          ) : (
            openInvoices.map((invoice) => (
              <Card key={invoice.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{invoice.quote?.job?.customer?.name ?? "Customer"}</span>
                  <span className="tabular-nums font-medium">
                    £{invoice.amount.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge tone={invoiceStatusTone[invoice.status] ?? "neutral"}>
                      {invoiceStatusLabel[invoice.status] ?? invoice.status}
                    </Badge>
                    <span className="text-xs text-text-muted">
                      {invoiceTypeLabel[invoice.invoice_type] ?? invoice.invoice_type}
                      {invoice.due_date ? ` · due ${invoice.due_date}` : ""}
                    </span>
                  </div>
                  {invoice.stripe_payment_link_url && (
                    <a
                      href={invoice.stripe_payment_link_url}
                      className="text-sm text-accent underline underline-offset-4"
                    >
                      Payment link
                    </a>
                  )}
                </div>
              </Card>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
