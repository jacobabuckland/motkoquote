import { PageHeader } from "@/components/ui/page-header";

/**
 * Loading skeleton for voice ledger query page.
 * Shown during navigation to /ledger/query.
 */
export default function LedgerQueryLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader backHref="/jobs" backLabel="Back to dashboard" />
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="h-8 w-48 animate-pulse rounded bg-border" />
            <div className="h-5 w-32 animate-pulse rounded bg-border" />
          </div>
          <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-border" />
        </div>
      </main>
    </div>
  );
}
