import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function QuoteLoading() {
  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        {/* Header area */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* Line items card */}
        <Card className="flex flex-col divide-y divide-border p-0">
          <div className="flex justify-between gap-4 px-4 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-16" />
          </div>
        </Card>

        {/* Totals section */}
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>

        {/* Action area */}
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </main>
  );
}
