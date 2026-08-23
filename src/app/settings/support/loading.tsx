import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the support layout: back header → title → intro line → one card
// holding a subject field, a message field and the send button.
export default function SupportLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-6 py-4">
          <Skeleton className="h-4 w-16" />
        </div>
      </header>
      <main className="flex flex-1 justify-center p-6">
        <div className="w-full max-w-xl">
          <Skeleton className="mb-2 h-8 w-44" />
          <Skeleton className="mb-6 h-4 w-full" />
          <Card className="flex flex-col gap-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-11 w-36" />
          </Card>
        </div>
      </main>
    </div>
  );
}
