import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the job hub (back bar → status + stepper → quote cards) so the real
// content lands in place without shifting.
export default function JobLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-16" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-32 rounded-control" />
        </div>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </Card>
        ))}
      </main>
    </div>
  );
}
