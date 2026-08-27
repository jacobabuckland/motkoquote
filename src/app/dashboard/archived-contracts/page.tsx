import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ResolvedContractRow } from "../resolved-contract-row";

// Everything the contractor has swept off the dashboard, and the way back.
//
// The same row component as the dashboard list, passed `archived` so the swipe
// reveals Restore instead of Archive. Same date, same order, same everything
// else — this is the identical list with the filter inverted, and building it
// out of a second component would let the two drift.
//
// No delete here, and no second archive action. The only thing that can happen
// to a contract on this screen is that it goes back.

type ArchivedContract = {
  id: string;
  status: string;
  status_changed_at: string | null;
  quote: { job: { id: string; customer: { name: string } | null } | null } | null;
};

export default async function ArchivedContractsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("contracts")
    .select(
      "id, status, status_changed_at, quote:quotes(job:jobs(id, customer:customers(name)))",
    )
    .in("status", ["signed", "declined"])
    .not("archived_at", "is", null)
    // Newest first, by the date it was signed or declined — NOT by the date it
    // was archived. The contractor is looking for a job, and they remember when
    // the work happened, not when they tidied the list.
    .order("status_changed_at", { ascending: false, nullsFirst: false });

  const contracts = (data ?? []) as unknown as ArchivedContract[];

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/dashboard" backLabel="Dashboard" title="Archived contracts" />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        {contracts.length === 0 ? (
          <EmptyState
            title="Nothing archived"
            description="Swipe a signed or declined contract on your dashboard to tuck it away here."
          />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-card border border-line-strong bg-card">
            {contracts.map((contract) => (
              <ResolvedContractRow
                key={contract.id}
                archived
                contractId={contract.id}
                customerName={contract.quote?.job?.customer?.name ?? "Customer"}
                status={contract.status}
                statusDate={contract.status_changed_at}
                jobId={contract.quote?.job?.id}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
