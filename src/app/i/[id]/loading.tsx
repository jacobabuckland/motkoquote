import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvoiceLoading() {
  return (
    <main className="flex flex-1 justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        {/* Header area */}
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* Amount and payment card */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-3 w-full" />
        </Card>
      </div>
    </main>
  );
}
