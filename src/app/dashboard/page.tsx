import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateInvoiceForm } from "./create-invoice-form";

type AcceptedQuote = {
  id: string;
  total: number;
  accepted_at: string | null;
  job: { customer: { name: string } | null } | null;
  invoices: { id: string }[];
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

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: contractor } = await supabase
    .from("contractors")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!contractor) redirect("/setup");

  const { data: acceptedQuotesRaw } = await supabase
    .from("quotes")
    .select("id, total, accepted_at, job:jobs(customer:customers(name)), invoices(id)")
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false });

  const acceptedQuotes = (acceptedQuotesRaw ?? []) as unknown as AcceptedQuote[];
  const quotesNeedingInvoice = acceptedQuotes.filter((q) => q.invoices.length === 0);

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
    <main className="flex flex-1 flex-col p-6 gap-8 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm text-neutral-500">Outstanding quotes</h2>
        {sentQuotes.length === 0 && (
          <p className="text-sm text-neutral-400">Nothing waiting on a customer.</p>
        )}
        {sentQuotes.map((quote) => (
          <div key={quote.id} className="border rounded-md p-4 flex justify-between text-sm">
            <span>{quote.job?.customer?.name ?? "Customer"}</span>
            <div className="flex flex-col items-end gap-0.5">
              <span>£{quote.total.toFixed(2)}</span>
              <span className="text-xs text-neutral-500">
                {quote.viewed_at ? "Viewed" : "Not viewed yet"}
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm text-neutral-500">
          Accepted quotes awaiting invoice
        </h2>
        {quotesNeedingInvoice.length === 0 && (
          <p className="text-sm text-neutral-400">Nothing waiting here.</p>
        )}
        {quotesNeedingInvoice.map((quote) => (
          <div key={quote.id} className="border rounded-md p-4 flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <span>{quote.job?.customer?.name ?? "Customer"}</span>
              <span>£{quote.total.toFixed(2)}</span>
            </div>
            <CreateInvoiceForm quoteId={quote.id} quoteTotal={quote.total} />
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-sm text-neutral-500">Unpaid invoices</h2>
        {openInvoices.length === 0 && (
          <p className="text-sm text-neutral-400">No outstanding invoices.</p>
        )}
        {openInvoices.map((invoice) => (
          <div key={invoice.id} className="border rounded-md p-4 flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span>{invoice.quote?.job?.customer?.name ?? "Customer"}</span>
              <span>£{invoice.amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-neutral-500 text-xs">
              <span>
                {invoice.invoice_type} · {invoice.status}
                {invoice.due_date ? ` · due ${invoice.due_date}` : ""}
              </span>
              {invoice.stripe_payment_link_url && (
                <a href={invoice.stripe_payment_link_url} className="underline">
                  Payment link
                </a>
              )}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
