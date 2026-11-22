import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the chat layout (header, a quote card, the composer) so content swaps
// in without a layout jump.
export default function ChatLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 pb-4 pt-bar-safe">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-5 pt-4">
        <Skeleton className="h-10 w-2/3 self-end rounded-card" />
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-11 w-full rounded-control" />
        </Card>
        <Skeleton className="mt-auto h-11 w-full rounded-control" />
      </main>
    </div>
  );
}
