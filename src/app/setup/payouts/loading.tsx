import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the payout step's layout (header → heading → card → skip) so content
// swaps in without a layout jump.
export default function SetupPayoutsLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 pb-4 pt-bar-safe">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </header>
      <main className="flex flex-1 justify-center p-6">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="h-24 w-full rounded-card" />
          <Skeleton className="h-11 w-40 rounded-control" />
        </div>
      </main>
    </div>
  );
}
