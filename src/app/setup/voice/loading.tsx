import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// Mirrors the voice setup page layout (header → centered content) so content
// swaps in without a layout jump.
export default function SetupVoiceLoading() {
  return (
    <div aria-hidden="true" className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-6 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex w-full max-w-sm flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Card className="flex w-full flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </Card>
          <Skeleton className="h-20 w-20 rounded-full" />
        </div>
      </main>
    </div>
  );
}
