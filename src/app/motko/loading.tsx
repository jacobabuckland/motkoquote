import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the "Speak to Motko" hub layout (header → title → two action cards)
// so content swaps in without a layout jump.
export default function MotkoLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 p-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col items-start gap-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-11 w-28 rounded-control" />
          </Card>

          <Card className="flex flex-col items-start gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-11 w-36 rounded-control" />
          </Card>
        </div>
      </main>
    </div>
  );
}
