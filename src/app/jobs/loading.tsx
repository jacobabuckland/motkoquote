import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the jobs history page layout (header → title + button → filters →
// search → totals → job list) so content swaps in without a layout jump.
// Renders 3 job rows as a representative default.
export default function JobsLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-11 w-28 rounded-control" />
        </div>

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-control" />
          <Skeleton className="h-11 w-20 rounded-control" />
        </div>

        {/* Totals band */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 rounded-card border border-border bg-surface-hover p-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>

        {/* Job list - 3 representative rows */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-16" />
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
